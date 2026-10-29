import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  SlashCommandBuilder,
  type AutocompleteInteraction,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type TextChannel,
} from "discord.js";
import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  challengeExercises,
  challengeProgress,
  challengeScores,
  challengeTargets,
  challenges,
  type Metric,
} from "../db/schema.js";
import {
  announceProgressHits,
  claimTier,
  getActiveChallenge,
  recomputeScore,
  type ProgressHit,
} from "../challenges/engine.js";
import { findTemplateByTitle, searchTemplates } from "../hevy/templates.js";
import { describeTarget, evaluateTarget } from "../util/metrics.js";
import { isGuildAdmin, requireGuild } from "../util/permissions.js";
import { nowIso } from "../util/time.js";
import type { HevyWorkout } from "../hevy/types.js";

const METRICS: { name: string; value: Metric }[] = [
  { name: "Weight × reps", value: "weight_reps" },
  { name: "Estimated 1RM", value: "e1rm" },
  { name: "Session volume", value: "session_volume" },
  { name: "Reps", value: "reps" },
  { name: "Duration (seconds)", value: "duration" },
];

export const challengeCommand = new SlashCommandBuilder()
  .setName("challenge")
  .setDescription("Gym challenges and leaderboards")
  .addSubcommand((s) =>
    s
      .setName("create")
      .setDescription("Create a draft challenge (admin)")
      .addStringOption((o) => o.setName("name").setDescription("Challenge name").setRequired(true)),
  )
  .addSubcommand((s) =>
    s
      .setName("add-exercise")
      .setDescription("Add an exercise to a challenge (admin)")
      .addStringOption((o) =>
        o.setName("exercise").setDescription("Exercise name").setRequired(true).setAutocomplete(true),
      )
      .addStringOption((o) =>
        o.setName("challenge").setDescription("Challenge name").setAutocomplete(true),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName("set-target")
      .setDescription("Set a tier target for an exercise (admin)")
      .addStringOption((o) =>
        o.setName("exercise").setDescription("Exercise in the challenge").setRequired(true).setAutocomplete(true),
      )
      .addIntegerOption((o) =>
        o.setName("tier").setDescription("Tier 1–5").setRequired(true).setMinValue(1).setMaxValue(5),
      )
      .addStringOption((o) =>
        o
          .setName("metric")
          .setDescription("How the target is measured")
          .setRequired(true)
          .addChoices(...METRICS),
      )
      .addNumberOption((o) =>
        o.setName("value").setDescription("Primary target (kg for weight metrics, reps, seconds, etc.)").setRequired(true),
      )
      .addNumberOption((o) =>
        o.setName("reps").setDescription("Required reps (for weight_reps metric)"),
      )
      .addStringOption((o) =>
        o.setName("challenge").setDescription("Challenge name").setAutocomplete(true),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName("activate")
      .setDescription("Activate a draft challenge (admin)")
      .addStringOption((o) =>
        o.setName("challenge").setDescription("Challenge name").setRequired(true).setAutocomplete(true),
      )
      .addStringOption((o) => o.setName("ends_at").setDescription("Optional ISO end date")),
  )
  .addSubcommand((s) =>
    s
      .setName("close")
      .setDescription("Close a challenge and post the podium (admin)")
      .addStringOption((o) =>
        o.setName("challenge").setDescription("Challenge name").setAutocomplete(true),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName("submit")
      .setDescription("Manually submit a tier hit")
      .addStringOption((o) =>
        o.setName("exercise").setDescription("Exercise").setRequired(true).setAutocomplete(true),
      )
      .addIntegerOption((o) =>
        o.setName("tier").setDescription("Tier 1–5").setRequired(true).setMinValue(1).setMaxValue(5),
      )
      .addNumberOption((o) => o.setName("value").setDescription("Value achieved (optional override)"))
      .addNumberOption((o) => o.setName("reps").setDescription("Reps achieved (for weight_reps)"))
      .addNumberOption((o) => o.setName("weight").setDescription("Weight kg achieved (for weight_reps)"))
      .addStringOption((o) => o.setName("challenge").setDescription("Challenge name").setAutocomplete(true))
      .addStringOption((o) => o.setName("notes").setDescription("Optional notes")),
  )
  .addSubcommand((s) =>
    s
      .setName("leaderboard")
      .setDescription("Overall challenge leaderboard")
      .addStringOption((o) =>
        o
          .setName("sort")
          .setDescription("Sort by")
          .addChoices(
            { name: "Total points", value: "total" },
            { name: "Bonus depth", value: "bonus" },
          ),
      )
      .addStringOption((o) => o.setName("challenge").setDescription("Challenge name").setAutocomplete(true)),
  )
  .addSubcommand((s) =>
    s
      .setName("board")
      .setDescription("Per-exercise challenge board")
      .addStringOption((o) =>
        o.setName("exercise").setDescription("Exercise").setRequired(true).setAutocomplete(true),
      )
      .addStringOption((o) => o.setName("challenge").setDescription("Challenge name").setAutocomplete(true)),
  )
  .addSubcommand((s) =>
    s
      .setName("progress")
      .setDescription("Personal challenge progress matrix")
      .addUserOption((o) => o.setName("user").setDescription("User to view"))
      .addStringOption((o) => o.setName("challenge").setDescription("Challenge name").setAutocomplete(true)),
  )
  .addSubcommand((s) =>
    s
      .setName("standings")
      .setDescription("Compact top 5 + your rank")
      .addStringOption((o) => o.setName("challenge").setDescription("Challenge name").setAutocomplete(true)),
  )
  .addSubcommand((s) =>
    s.setName("list").setDescription("List challenges in this server"),
  );

async function resolveChallenge(guildId: string, name?: string | null) {
  return getActiveChallenge(guildId, name);
}

async function challengeNameChoices(guildId: string, focused: string) {
  const rows = await db.select().from(challenges).where(eq(challenges.guildId, guildId));
  const q = focused.toLowerCase();
  return rows
    .filter((c) => !q || c.name.toLowerCase().includes(q))
    .slice(0, 25)
    .map((c) => ({ name: `${c.name} (${c.status})`, value: c.name }));
}

async function challengeExerciseChoices(guildId: string, challengeName: string | null, focused: string) {
  const challenge = await resolveChallenge(guildId, challengeName);
  if (!challenge) {
    // fall back to hevy template search for add-exercise on draft
    const templates = await searchTemplates(guildId, focused);
    return templates.map((t) => ({ name: t.title, value: t.title }));
  }
  const exercises = await db
    .select()
    .from(challengeExercises)
    .where(eq(challengeExercises.challengeId, challenge.id));
  const q = focused.toLowerCase();
  const fromChallenge = exercises
    .filter((e) => !q || e.title.toLowerCase().includes(q))
    .slice(0, 25)
    .map((e) => ({ name: e.title, value: e.title }));
  if (fromChallenge.length) return fromChallenge;
  const templates = await searchTemplates(guildId, focused);
  return templates.map((t) => ({ name: t.title, value: t.title }));
}

export async function handleChallengeAutocomplete(interaction: AutocompleteInteraction) {
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.respond([]);
    return;
  }
  const focused = interaction.options.getFocused(true);
  const challengeName = interaction.options.getString("challenge");

  if (focused.name === "challenge") {
    await interaction.respond(await challengeNameChoices(guildId, focused.value));
    return;
  }
  if (focused.name === "exercise") {
    const sub = interaction.options.getSubcommand();
    if (sub === "add-exercise") {
      const templates = await searchTemplates(guildId, focused.value);
      await interaction.respond(templates.map((t) => ({ name: t.title, value: t.title })));
      return;
    }
    await interaction.respond(await challengeExerciseChoices(guildId, challengeName, focused.value));
    return;
  }
  await interaction.respond([]);
}

function sortedScores(
  rows: (typeof challengeScores.$inferSelect)[],
  sort: "total" | "bonus",
) {
  return [...rows].sort((a, b) => {
    if (sort === "bonus") {
      if (b.bonusPoints !== a.bonusPoints) return b.bonusPoints - a.bonusPoints;
    }
    if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;
    return a.scoreUpdatedAt.localeCompare(b.scoreUpdatedAt);
  });
}

function leaderboardEmbed(
  challengeName: string,
  rows: (typeof challengeScores.$inferSelect)[],
  page: number,
  sort: "total" | "bonus",
) {
  const pageSize = 10;
  const sorted = sortedScores(rows, sort);
  const start = page * pageSize;
  const slice = sorted.slice(start, start + pageSize);
  const lines =
    slice.map((r, i) => {
      const rank = start + i + 1;
      return `**${rank}.** <@${r.discordUserId}> — **${r.totalPoints}** (tiers ${r.tierPoints} + bonus ${r.bonusPoints})`;
    }).join("\n") || "_No scores yet._";

  return new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle(`${challengeName} leaderboard`)
    .setDescription(lines)
    .setFooter({
      text: `Sort: ${sort} · page ${page + 1}/${Math.max(1, Math.ceil(sorted.length / pageSize))}`,
    });
}

function leaderboardButtons(challengeId: number, page: number, sort: "total" | "bonus", maxPage: number) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`lb:${challengeId}:${page - 1}:${sort}`)
      .setLabel("Prev")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page <= 0),
    new ButtonBuilder()
      .setCustomId(`lb:${challengeId}:${page + 1}:${sort}`)
      .setLabel("Next")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= maxPage),
  );
}

export async function handleLeaderboardButton(interaction: ButtonInteraction) {
  const parts = interaction.customId.split(":");
  if (parts[0] !== "lb") return;
  const challengeId = Number(parts[1]);
  const page = Number(parts[2]);
  const sort = (parts[3] as "total" | "bonus") || "total";
  const challengeRows = await db.select().from(challenges).where(eq(challenges.id, challengeId));
  const challenge = challengeRows[0];
  if (!challenge) {
    await interaction.reply({ content: "Challenge not found.", ephemeral: true });
    return;
  }
  const scores = await db.select().from(challengeScores).where(eq(challengeScores.challengeId, challengeId));
  const maxPage = Math.max(0, Math.ceil(scores.length / 10) - 1);
  const safePage = Math.min(Math.max(0, page), maxPage);
  await interaction.update({
    embeds: [leaderboardEmbed(challenge.name, scores, safePage, sort)],
    components: [leaderboardButtons(challengeId, safePage, sort, maxPage)],
  });
}

export async function handleChallenge(interaction: ChatInputCommandInteraction) {
  const guildId = await requireGuild(interaction);
  if (!guildId) return;
  const sub = interaction.options.getSubcommand();

  if (sub === "create") {
    if (!isGuildAdmin(interaction)) {
      await interaction.reply({ content: "Requires Manage Server.", ephemeral: true });
      return;
    }
    const name = interaction.options.getString("name", true).trim();
    const now = nowIso();
    try {
      await db.insert(challenges).values({
        guildId,
        name,
        status: "draft",
        createdBy: interaction.user.id,
        createdAt: now,
        updatedAt: now,
      });
      await interaction.reply({ content: `Draft challenge **${name}** created.`, ephemeral: true });
    } catch {
      await interaction.reply({ content: "A challenge with that name already exists.", ephemeral: true });
    }
    return;
  }

  if (sub === "add-exercise") {
    if (!isGuildAdmin(interaction)) {
      await interaction.reply({ content: "Requires Manage Server.", ephemeral: true });
      return;
    }
    await interaction.deferReply({ ephemeral: true });
    const challengeName = interaction.options.getString("challenge");
    const challenge = challengeName
      ? (await db.select().from(challenges).where(and(eq(challenges.guildId, guildId), eq(challenges.name, challengeName))))[0]
      : (await db.select().from(challenges).where(and(eq(challenges.guildId, guildId), eq(challenges.status, "draft"))))[0];
    if (!challenge) {
      await interaction.editReply("No challenge found. Create one or pass `challenge:`.");
      return;
    }
    if (challenge.status === "closed") {
      await interaction.editReply("Cannot edit a closed challenge.");
      return;
    }
    const exerciseTitle = interaction.options.getString("exercise", true);
    const template = await findTemplateByTitle(guildId, exerciseTitle);
    if (!template) {
      await interaction.editReply(
        "Exercise not found in Hevy templates. Link a Hevy account first (`/hevy link`) so templates can load.",
      );
      return;
    }
    const existing = await db
      .select()
      .from(challengeExercises)
      .where(eq(challengeExercises.challengeId, challenge.id));
    try {
      await db.insert(challengeExercises).values({
        challengeId: challenge.id,
        exerciseTemplateId: template.id,
        title: template.title,
        sortOrder: existing.length,
      });
      await interaction.editReply(`Added **${template.title}** to **${challenge.name}**.`);
    } catch {
      await interaction.editReply("That exercise is already in the challenge.");
    }
    return;
  }

  if (sub === "set-target") {
    if (!isGuildAdmin(interaction)) {
      await interaction.reply({ content: "Requires Manage Server.", ephemeral: true });
      return;
    }
    const challengeName = interaction.options.getString("challenge");
    const challenge = await resolveChallenge(guildId, challengeName);
    if (!challenge) {
      await interaction.reply({ content: "Challenge not found.", ephemeral: true });
      return;
    }
    if (challenge.status === "closed") {
      await interaction.reply({ content: "Cannot edit a closed challenge.", ephemeral: true });
      return;
    }
    const exerciseTitle = interaction.options.getString("exercise", true);
    const exercises = await db
      .select()
      .from(challengeExercises)
      .where(eq(challengeExercises.challengeId, challenge.id));
    const ex = exercises.find((e) => e.title.toLowerCase() === exerciseTitle.toLowerCase());
    if (!ex) {
      await interaction.reply({ content: "Exercise not in this challenge. Use `/challenge add-exercise` first.", ephemeral: true });
      return;
    }
    const tier = interaction.options.getInteger("tier", true);
    const metric = interaction.options.getString("metric", true) as Metric;
    const value = interaction.options.getNumber("value", true);
    const reps = interaction.options.getNumber("reps");
    if (metric === "weight_reps" && reps == null) {
      await interaction.reply({ content: "`reps` is required for weight_reps metric.", ephemeral: true });
      return;
    }
    await db
      .insert(challengeTargets)
      .values({
        challengeExerciseId: ex.id,
        tier,
        metric,
        targetValue: value,
        targetSecondary: reps ?? null,
      })
      .onConflictDoUpdate({
        target: [challengeTargets.challengeExerciseId, challengeTargets.tier],
        set: {
          metric,
          targetValue: value,
          targetSecondary: reps ?? null,
        },
      });
    await interaction.reply({
      content: `Tier **${tier}** for **${ex.title}**: ${describeTarget(metric, value, reps)}`,
      ephemeral: true,
    });
    return;
  }

  if (sub === "activate") {
    if (!isGuildAdmin(interaction)) {
      await interaction.reply({ content: "Requires Manage Server.", ephemeral: true });
      return;
    }
    const name = interaction.options.getString("challenge", true);
    const endsAt = interaction.options.getString("ends_at");
    const rows = await db
      .select()
      .from(challenges)
      .where(and(eq(challenges.guildId, guildId), eq(challenges.name, name)));
    const challenge = rows[0];
    if (!challenge) {
      await interaction.reply({ content: "Challenge not found.", ephemeral: true });
      return;
    }
    const exercises = await db
      .select()
      .from(challengeExercises)
      .where(eq(challengeExercises.challengeId, challenge.id));
    if (!exercises.length) {
      await interaction.reply({ content: "Add at least one exercise before activating.", ephemeral: true });
      return;
    }
    // deactivate other actives? allow multiple — plan says default to active; keep multiple ok
    await db
      .update(challenges)
      .set({
        status: "active",
        startsAt: nowIso(),
        endsAt: endsAt ?? null,
        updatedAt: nowIso(),
      })
      .where(eq(challenges.id, challenge.id));
    await interaction.reply({ content: `Challenge **${name}** is now **active**.`, ephemeral: false });
    return;
  }

  if (sub === "close") {
    if (!isGuildAdmin(interaction)) {
      await interaction.reply({ content: "Requires Manage Server.", ephemeral: true });
      return;
    }
    const challenge = await resolveChallenge(guildId, interaction.options.getString("challenge"));
    if (!challenge) {
      await interaction.reply({ content: "Challenge not found.", ephemeral: true });
      return;
    }
    await db
      .update(challenges)
      .set({ status: "closed", updatedAt: nowIso() })
      .where(eq(challenges.id, challenge.id));

    const scores = await db
      .select()
      .from(challengeScores)
      .where(eq(challengeScores.challengeId, challenge.id));
    const podium = sortedScores(scores, "total").slice(0, 3);
    const medals = ["🥇", "🥈", "🥉"];
    const lines = podium.map((r, i) => `${medals[i]} <@${r.discordUserId}> — **${r.totalPoints}** pts`).join("\n");
    const embed = new EmbedBuilder()
      .setColor(0xe67e22)
      .setTitle(`${challenge.name} — final podium`)
      .setDescription(lines || "_No participants._")
      .setFooter({ text: `Use /challenge leaderboard challenge:${challenge.name} for the full board` });

    await interaction.reply({ embeds: [embed] });
    return;
  }

  if (sub === "submit") {
    await interaction.deferReply({ ephemeral: true });
    const challenge = await resolveChallenge(guildId, interaction.options.getString("challenge"));
    if (!challenge || challenge.status !== "active") {
      await interaction.editReply("No active challenge found.");
      return;
    }
    const exerciseTitle = interaction.options.getString("exercise", true);
    const exercises = await db
      .select()
      .from(challengeExercises)
      .where(eq(challengeExercises.challengeId, challenge.id));
    const ex = exercises.find((e) => e.title.toLowerCase() === exerciseTitle.toLowerCase());
    if (!ex) {
      await interaction.editReply("Exercise not in this challenge.");
      return;
    }
    const tier = interaction.options.getInteger("tier", true);
    const targets = await db
      .select()
      .from(challengeTargets)
      .where(and(eq(challengeTargets.challengeExerciseId, ex.id), eq(challengeTargets.tier, tier)));
    const target = targets[0];
    if (!target) {
      await interaction.editReply("That tier has no target configured.");
      return;
    }

    const weight = interaction.options.getNumber("weight");
    const reps = interaction.options.getNumber("reps");
    const valueOpt = interaction.options.getNumber("value");
    const notes = interaction.options.getString("notes");

    // Build a synthetic workout for evaluation when weight/reps provided
    let valueAchieved = valueOpt;
    if (valueAchieved == null && (weight != null || reps != null)) {
      const synthetic: HevyWorkout = {
        id: "manual",
        title: "Manual submit",
        start_time: nowIso(),
        end_time: nowIso(),
        exercises: [
          {
            index: 0,
            title: ex.title,
            exercise_template_id: ex.exerciseTemplateId,
            sets: [
              {
                index: 0,
                type: "normal",
                weight_kg: weight ?? target.targetValue,
                reps: reps ?? target.targetSecondary ?? 1,
                distance_meters: null,
                duration_seconds: valueOpt,
                rpe: null,
                custom_metric: null,
              },
            ],
          },
        ],
      };
      valueAchieved = evaluateTarget(
        synthetic,
        ex.exerciseTemplateId,
        target.metric as Metric,
        target.targetValue,
        target.targetSecondary,
      );
      if (valueAchieved == null) {
        await interaction.editReply(
          `Submission does not meet ${describeTarget(target.metric as Metric, target.targetValue, target.targetSecondary)}.`,
        );
        return;
      }
    } else if (valueAchieved == null) {
      // trust manual claim without numbers
      valueAchieved = target.targetValue;
    } else if (target.metric !== "weight_reps" && valueAchieved < target.targetValue) {
      await interaction.editReply(`Value ${valueAchieved} is below target ${target.targetValue}.`);
      return;
    }

    const beforeScores = await db
      .select()
      .from(challengeScores)
      .where(
        and(
          eq(challengeScores.challengeId, challenge.id),
          eq(challengeScores.discordUserId, interaction.user.id),
        ),
      );
    const previousBonus = beforeScores[0]?.bonusPoints ?? 0;
    const previousTotal = beforeScores[0]?.totalPoints ?? 0;

    const ok = await claimTier({
      challengeId: challenge.id,
      challengeExerciseId: ex.id,
      discordUserId: interaction.user.id,
      tier,
      source: "manual",
      achievedAt: nowIso(),
      valueAchieved: valueAchieved ?? null,
      notes,
    });
    if (!ok) {
      await interaction.editReply("Could not claim (need previous tier, or already claimed).");
      return;
    }
    const after = await recomputeScore(challenge.id, interaction.user.id);
    const hit: ProgressHit = {
      challengeId: challenge.id,
      challengeName: challenge.name,
      exerciseId: ex.id,
      exerciseTitle: ex.title,
      tier,
      metric: target.metric as Metric,
      valueAchieved: valueAchieved ?? 0,
      previousBonus,
      newBonus: after.bonusPoints,
      previousTotal,
      newTotal: after.totalPoints,
      tookLead: false,
    };
    await announceProgressHits(interaction.client, guildId, interaction.user.id, [hit]);
    await interaction.editReply(
      `Claimed **${ex.title}** tier ${tier}. Score: **${after.totalPoints}** (tiers ${after.tierPoints} + bonus ${after.bonusPoints}).`,
    );
    return;
  }

  if (sub === "leaderboard") {
    const challenge = await resolveChallenge(guildId, interaction.options.getString("challenge"));
    if (!challenge) {
      await interaction.reply({ content: "Challenge not found.", ephemeral: true });
      return;
    }
    const sort = (interaction.options.getString("sort") as "total" | "bonus") || "total";
    const scores = await db
      .select()
      .from(challengeScores)
      .where(eq(challengeScores.challengeId, challenge.id));
    const maxPage = Math.max(0, Math.ceil(scores.length / 10) - 1);
    await interaction.reply({
      embeds: [leaderboardEmbed(challenge.name, scores, 0, sort)],
      components: [leaderboardButtons(challenge.id, 0, sort, maxPage)],
    });
    return;
  }

  if (sub === "board") {
    const challenge = await resolveChallenge(guildId, interaction.options.getString("challenge"));
    if (!challenge) {
      await interaction.reply({ content: "Challenge not found.", ephemeral: true });
      return;
    }
    const exerciseTitle = interaction.options.getString("exercise", true);
    const exercises = await db
      .select()
      .from(challengeExercises)
      .where(eq(challengeExercises.challengeId, challenge.id));
    const ex = exercises.find((e) => e.title.toLowerCase() === exerciseTitle.toLowerCase());
    if (!ex) {
      await interaction.reply({ content: "Exercise not in challenge.", ephemeral: true });
      return;
    }
    const progress = await db
      .select()
      .from(challengeProgress)
      .where(
        and(
          eq(challengeProgress.challengeId, challenge.id),
          eq(challengeProgress.challengeExerciseId, ex.id),
        ),
      );
    const byUser = new Map<string, { tier: number; at: string; value: number | null }>();
    for (const p of progress) {
      const cur = byUser.get(p.discordUserId);
      if (!cur || p.tier > cur.tier) {
        byUser.set(p.discordUserId, { tier: p.tier, at: p.achievedAt, value: p.valueAchieved });
      }
    }
    const ranked = [...byUser.entries()].sort((a, b) => {
      if (b[1].tier !== a[1].tier) return b[1].tier - a[1].tier;
      return a[1].at.localeCompare(b[1].at);
    });
    const lines =
      ranked
        .map(
          ([uid, info], i) =>
            `**${i + 1}.** <@${uid}> — tier **${info.tier}** · <t:${Math.floor(new Date(info.at).getTime() / 1000)}:R>`,
        )
        .join("\n") || "_No progress yet._";
    const embed = new EmbedBuilder()
      .setColor(0x1abc9c)
      .setTitle(`${challenge.name} — ${ex.title}`)
      .setDescription(lines);
    await interaction.reply({ embeds: [embed] });
    return;
  }

  if (sub === "progress") {
    const challenge = await resolveChallenge(guildId, interaction.options.getString("challenge"));
    if (!challenge) {
      await interaction.reply({ content: "Challenge not found.", ephemeral: true });
      return;
    }
    const user = interaction.options.getUser("user") ?? interaction.user;
    const exercises = await db
      .select()
      .from(challengeExercises)
      .where(eq(challengeExercises.challengeId, challenge.id))
      .orderBy(asc(challengeExercises.sortOrder));
    const progress = await db
      .select()
      .from(challengeProgress)
      .where(
        and(
          eq(challengeProgress.challengeId, challenge.id),
          eq(challengeProgress.discordUserId, user.id),
        ),
      );
    const claimed = new Map<number, Set<number>>();
    for (const p of progress) {
      if (!claimed.has(p.challengeExerciseId)) claimed.set(p.challengeExerciseId, new Set());
      claimed.get(p.challengeExerciseId)!.add(p.tier);
    }
    const lines: string[] = [];
    for (const ex of exercises) {
      const set = claimed.get(ex.id) ?? new Set();
      const boxes = [1, 2, 3, 4, 5].map((t) => (set.has(t) ? "✅" : "⬜")).join("");
      const targets = await db
        .select()
        .from(challengeTargets)
        .where(eq(challengeTargets.challengeExerciseId, ex.id))
        .orderBy(asc(challengeTargets.tier));
      const next = targets.find((t) => !set.has(t.tier));
      const nextDesc = next
        ? describeTarget(next.metric as Metric, next.targetValue, next.targetSecondary)
        : "complete";
      lines.push(`**${ex.title}** ${boxes} → next: ${nextDesc}`);
    }
    const score = await recomputeScore(challenge.id, user.id);
    const embed = new EmbedBuilder()
      .setColor(0x9b59b6)
      .setTitle(`${challenge.name} — ${user.username}`)
      .setDescription(lines.join("\n") || "_No exercises._")
      .addFields({
        name: "Score",
        value: `**${score.totalPoints}** (tiers ${score.tierPoints} + bonus ${score.bonusPoints})`,
      });
    await interaction.reply({ embeds: [embed] });
    return;
  }

  if (sub === "standings") {
    const challenge = await resolveChallenge(guildId, interaction.options.getString("challenge"));
    if (!challenge) {
      await interaction.reply({ content: "Challenge not found.", ephemeral: true });
      return;
    }
    const scores = await db
      .select()
      .from(challengeScores)
      .where(eq(challengeScores.challengeId, challenge.id));
    const sorted = sortedScores(scores, "total");
    const top = sorted.slice(0, 5);
    const myIdx = sorted.findIndex((s) => s.discordUserId === interaction.user.id);
    const lines = top
      .map((r, i) => `**${i + 1}.** <@${r.discordUserId}> — **${r.totalPoints}**`)
      .join("\n");
    const you =
      myIdx >= 0
        ? `Your rank: **#${myIdx + 1}** (${sorted[myIdx]!.totalPoints} pts)`
        : "You have no score yet.";
    const embed = new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle(`${challenge.name} standings`)
      .setDescription(`${lines || "_Empty._"}\n\n${you}`);
    await interaction.reply({ embeds: [embed] });
    return;
  }

  if (sub === "list") {
    const rows = await db
      .select()
      .from(challenges)
      .where(eq(challenges.guildId, guildId))
      .orderBy(desc(challenges.createdAt));
    const lines =
      rows.map((c) => `• **${c.name}** — \`${c.status}\``).join("\n") || "_No challenges._";
    await interaction.reply({ content: lines, ephemeral: true });
  }
}
