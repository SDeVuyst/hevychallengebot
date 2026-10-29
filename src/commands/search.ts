import {
  EmbedBuilder,
  SlashCommandBuilder,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
} from "discord.js";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { userLinks, workoutsCache } from "../db/schema.js";
import { HevyClient } from "../hevy/client.js";
import { decrypt } from "../hevy/crypto.js";
import { findTemplateByTitle, searchTemplates } from "../hevy/templates.js";
import type { HevyWorkout } from "../hevy/types.js";
import {
  exerciseBestE1rm,
  exerciseBestWeight,
  exerciseSessionVolume,
  formatWeight,
  workoutTotalVolume,
} from "../util/metrics.js";
import { requireGuild } from "../util/permissions.js";
import { formatDuration } from "../util/time.js";

async function getLink(guildId: string, discordUserId: string) {
  const rows = await db
    .select()
    .from(userLinks)
    .where(and(eq(userLinks.guildId, guildId), eq(userLinks.discordUserId, discordUserId)));
  return rows[0] ?? null;
}

async function hevyFor(guildId: string, discordUserId: string): Promise<{
  client: HevyClient;
  link: typeof userLinks.$inferSelect;
} | null> {
  const link = await getLink(guildId, discordUserId);
  if (!link) return null;
  return { client: new HevyClient(decrypt(link.hevyApiKeyEnc)), link };
}

function parseWorkout(row: typeof workoutsCache.$inferSelect): HevyWorkout {
  return JSON.parse(row.payloadJson) as HevyWorkout;
}

export const workoutCommand = new SlashCommandBuilder()
  .setName("workout")
  .setDescription("Browse workouts")
  .addSubcommand((s) =>
    s
      .setName("recent")
      .setDescription("Recent workouts")
      .addUserOption((o) => o.setName("user").setDescription("Discord user (must be linked)"))
      .addIntegerOption((o) =>
        o.setName("limit").setDescription("How many (1–10)").setMinValue(1).setMaxValue(10),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName("show")
      .setDescription("Show a workout by id or latest")
      .addStringOption((o) =>
        o.setName("id").setDescription("Hevy workout id, or 'latest'").setRequired(true),
      )
      .addUserOption((o) => o.setName("user").setDescription("Discord user")),
  );

export const statsCommand = new SlashCommandBuilder()
  .setName("stats")
  .setDescription("Exercise stats from Hevy")
  .addSubcommand((s) =>
    s
      .setName("exercise")
      .setDescription("Stats / history for an exercise")
      .addStringOption((o) =>
        o.setName("name").setDescription("Exercise").setRequired(true).setAutocomplete(true),
      )
      .addUserOption((o) => o.setName("user").setDescription("Discord user"))
      .addStringOption((o) =>
        o
          .setName("range")
          .setDescription("Date range")
          .addChoices(
            { name: "30 days", value: "30d" },
            { name: "90 days", value: "90d" },
            { name: "1 year", value: "365d" },
            { name: "All", value: "all" },
          ),
      ),
  );

export const compareCommand = new SlashCommandBuilder()
  .setName("compare")
  .setDescription("Compare linked users")
  .addSubcommand((s) =>
    s
      .setName("users")
      .setDescription("Side-by-side overview")
      .addUserOption((o) => o.setName("a").setDescription("User A").setRequired(true))
      .addUserOption((o) => o.setName("b").setDescription("User B").setRequired(true))
      .addIntegerOption((o) =>
        o.setName("days").setDescription("Lookback days (default 30)").setMinValue(7).setMaxValue(365),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName("exercise")
      .setDescription("Compare an exercise between two users")
      .addStringOption((o) =>
        o.setName("name").setDescription("Exercise").setRequired(true).setAutocomplete(true),
      )
      .addUserOption((o) => o.setName("a").setDescription("User A").setRequired(true))
      .addUserOption((o) => o.setName("b").setDescription("User B").setRequired(true)),
  );

export const prCommand = new SlashCommandBuilder()
  .setName("pr")
  .setDescription("Personal records from cached workouts")
  .addSubcommand((s) =>
    s
      .setName("list")
      .setDescription("List top PRs")
      .addUserOption((o) => o.setName("user").setDescription("Discord user"))
      .addIntegerOption((o) =>
        o.setName("limit").setDescription("How many (default 10)").setMinValue(1).setMaxValue(25),
      ),
  );

export async function handleSearchAutocomplete(interaction: AutocompleteInteraction) {
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.respond([]);
    return;
  }
  const focused = interaction.options.getFocused(true);
  if (focused.name === "name" || focused.name === "exercise") {
    const templates = await searchTemplates(guildId, focused.value);
    await interaction.respond(templates.map((t) => ({ name: t.title, value: t.title })));
    return;
  }
  await interaction.respond([]);
}

export async function handleWorkout(interaction: ChatInputCommandInteraction) {
  const guildId = await requireGuild(interaction);
  if (!guildId) return;
  const sub = interaction.options.getSubcommand();
  const user = interaction.options.getUser("user") ?? interaction.user;

  if (sub === "recent") {
    const limit = interaction.options.getInteger("limit") ?? 5;
    const rows = await db
      .select()
      .from(workoutsCache)
      .where(and(eq(workoutsCache.guildId, guildId), eq(workoutsCache.discordUserId, user.id)))
      .orderBy(desc(workoutsCache.endTime))
      .limit(limit);

    if (!rows.length) {
      // try live API
      const ctx = await hevyFor(guildId, user.id);
      if (!ctx) {
        await interaction.reply({
          content: `<@${user.id}> is not linked. They need \`/hevy link\`.`,
          ephemeral: true,
        });
        return;
      }
      await interaction.deferReply();
      const live = await ctx.client.getWorkouts(1, limit);
      const lines = (live.workouts ?? [])
        .map(
          (w) =>
            `• **${w.title}** — ${formatDuration(w.start_time, w.end_time)} · ${w.exercises.length} exercises · \`${w.id.slice(0, 8)}\``,
        )
        .join("\n");
      await interaction.editReply(lines || "No workouts found.");
      return;
    }

    const lines = rows
      .map((r) => {
        const w = parseWorkout(r);
        return `• **${r.title}** — ${formatDuration(r.startTime, r.endTime)} · ${w.exercises.length} exercises · \`${r.hevyWorkoutId.slice(0, 8)}\``;
      })
      .join("\n");
    await interaction.reply({ content: `Recent workouts for <@${user.id}>:\n${lines}` });
    return;
  }

  if (sub === "show") {
    const id = interaction.options.getString("id", true);
    await interaction.deferReply();
    let workout: HevyWorkout | null = null;

    if (id.toLowerCase() === "latest") {
      const rows = await db
        .select()
        .from(workoutsCache)
        .where(and(eq(workoutsCache.guildId, guildId), eq(workoutsCache.discordUserId, user.id)))
        .orderBy(desc(workoutsCache.endTime))
        .limit(1);
      if (rows[0]) workout = parseWorkout(rows[0]);
      else {
        const ctx = await hevyFor(guildId, user.id);
        if (!ctx) {
          await interaction.editReply(`<@${user.id}> is not linked.`);
          return;
        }
        const live = await ctx.client.getWorkouts(1, 1);
        workout = live.workouts?.[0] ?? null;
      }
    } else {
      const rows = await db
        .select()
        .from(workoutsCache)
        .where(
          and(
            eq(workoutsCache.guildId, guildId),
            eq(workoutsCache.discordUserId, user.id),
            eq(workoutsCache.hevyWorkoutId, id),
          ),
        );
      if (rows[0]) workout = parseWorkout(rows[0]);
      else {
        const ctx = await hevyFor(guildId, user.id);
        if (!ctx) {
          await interaction.editReply(`<@${user.id}> is not linked.`);
          return;
        }
        try {
          workout = await ctx.client.getWorkout(id);
        } catch {
          // try prefix match in cache
          const all = await db
            .select()
            .from(workoutsCache)
            .where(and(eq(workoutsCache.guildId, guildId), eq(workoutsCache.discordUserId, user.id)));
          const match = all.find((r) => r.hevyWorkoutId.startsWith(id));
          workout = match ? parseWorkout(match) : null;
        }
      }
    }

    if (!workout) {
      await interaction.editReply("Workout not found.");
      return;
    }

    const unit = ((await getLink(guildId, user.id))?.weightUnit as "kg" | "lbs") ?? "kg";
    const lines = workout.exercises
      .slice(0, 15)
      .map((e) => {
        const best = exerciseBestWeight(e);
        const sets = e.sets.filter((s) => s.type !== "warmup").length;
        return `• **${e.title}** — ${sets} sets · best ${formatWeight(best, unit)}`;
      })
      .join("\n");

    const embed = new EmbedBuilder()
      .setColor(0x1db954)
      .setTitle(workout.title)
      .setDescription(lines || "_No exercises_")
      .addFields(
        { name: "Duration", value: formatDuration(workout.start_time, workout.end_time), inline: true },
        { name: "Volume", value: formatWeight(workoutTotalVolume(workout), unit), inline: true },
        { name: "Id", value: `\`${workout.id}\``, inline: true },
      );
    await interaction.editReply({ embeds: [embed] });
  }
}

export async function handleStats(interaction: ChatInputCommandInteraction) {
  const guildId = await requireGuild(interaction);
  if (!guildId) return;
  const user = interaction.options.getUser("user") ?? interaction.user;
  const name = interaction.options.getString("name", true);
  const range = interaction.options.getString("range") ?? "90d";

  const ctx = await hevyFor(guildId, user.id);
  if (!ctx) {
    await interaction.reply({ content: `<@${user.id}> is not linked.`, ephemeral: true });
    return;
  }

  await interaction.deferReply();
  const template = await findTemplateByTitle(guildId, name);
  if (!template) {
    await interaction.editReply("Exercise template not found. Link someone so templates can load.");
    return;
  }

  let startDate: string | undefined;
  if (range !== "all") {
    const days = Number(range.replace("d", ""));
    startDate = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
  }

  const hist = await ctx.client.getExerciseHistory(template.id, startDate);
  const entries = hist.exercise_history ?? hist.history ?? [];

  // Also scan cache for PRs
  const cached = await db
    .select()
    .from(workoutsCache)
    .where(and(eq(workoutsCache.guildId, guildId), eq(workoutsCache.discordUserId, user.id)));

  let bestWeight = 0;
  let bestE1rm = 0;
  let bestVolume = 0;
  let sessions = 0;

  for (const row of cached) {
    const w = parseWorkout(row);
    for (const e of w.exercises) {
      if (e.exercise_template_id !== template.id) continue;
      if (startDate && w.start_time && w.start_time.slice(0, 10) < startDate) continue;
      sessions += 1;
      bestWeight = Math.max(bestWeight, exerciseBestWeight(e));
      bestE1rm = Math.max(bestE1rm, exerciseBestE1rm(e));
      bestVolume = Math.max(bestVolume, exerciseSessionVolume(e));
    }
  }

  // enrich from API history sets if present
  for (const entry of entries) {
    const sets = entry.sets ?? [];
    for (const s of sets) {
      if (s.type === "warmup") continue;
      if (s.weight_kg != null) bestWeight = Math.max(bestWeight, s.weight_kg);
      if (s.weight_kg != null && s.reps != null) {
        bestE1rm = Math.max(bestE1rm, s.weight_kg * (1 + s.reps / 30));
      }
    }
  }

  const unit = (ctx.link.weightUnit as "kg" | "lbs") ?? "kg";
  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle(`${template.title} — ${user.username}`)
    .addFields(
      { name: "Best weight", value: formatWeight(bestWeight, unit), inline: true },
      { name: "Best e1RM", value: formatWeight(bestE1rm, unit), inline: true },
      { name: "Best session volume", value: formatWeight(bestVolume, unit), inline: true },
      { name: "Cached sessions", value: String(sessions), inline: true },
      { name: "API history entries", value: String(entries.length), inline: true },
      { name: "Range", value: range, inline: true },
    );
  await interaction.editReply({ embeds: [embed] });
}

function summarizeUserWorkouts(
  rows: (typeof workoutsCache.$inferSelect)[],
  sinceIso: string,
) {
  let count = 0;
  let volume = 0;
  const days = new Set<string>();
  for (const row of rows) {
    if (row.endTime && row.endTime < sinceIso) continue;
    count += 1;
    if (row.endTime) days.add(row.endTime.slice(0, 10));
    volume += workoutTotalVolume(parseWorkout(row));
  }
  return { count, volume, days: days.size };
}

export async function handleCompare(interaction: ChatInputCommandInteraction) {
  const guildId = await requireGuild(interaction);
  if (!guildId) return;
  const sub = interaction.options.getSubcommand();
  const a = interaction.options.getUser("a", true);
  const b = interaction.options.getUser("b", true);

  if (sub === "users") {
    const days = interaction.options.getInteger("days") ?? 30;
    const since = new Date(Date.now() - days * 86400_000).toISOString();
    const rowsA = await db
      .select()
      .from(workoutsCache)
      .where(and(eq(workoutsCache.guildId, guildId), eq(workoutsCache.discordUserId, a.id)));
    const rowsB = await db
      .select()
      .from(workoutsCache)
      .where(and(eq(workoutsCache.guildId, guildId), eq(workoutsCache.discordUserId, b.id)));

    if (!rowsA.length && !(await getLink(guildId, a.id))) {
      await interaction.reply({ content: `<@${a.id}> is not linked / has no cached workouts.`, ephemeral: true });
      return;
    }
    if (!rowsB.length && !(await getLink(guildId, b.id))) {
      await interaction.reply({ content: `<@${b.id}> is not linked / has no cached workouts.`, ephemeral: true });
      return;
    }

    const sa = summarizeUserWorkouts(rowsA, since);
    const sb = summarizeUserWorkouts(rowsB, since);
    const unitA = ((await getLink(guildId, a.id))?.weightUnit as "kg" | "lbs") ?? "kg";

    const embed = new EmbedBuilder()
      .setColor(0xe67e22)
      .setTitle(`Compare · last ${days} days`)
      .addFields(
        {
          name: a.username,
          value: `Workouts: **${sa.count}**\nActive days: **${sa.days}**\nVolume: **${formatWeight(sa.volume, unitA)}**`,
          inline: true,
        },
        {
          name: b.username,
          value: `Workouts: **${sb.count}**\nActive days: **${sb.days}**\nVolume: **${formatWeight(sb.volume, unitA)}**`,
          inline: true,
        },
      );
    await interaction.reply({ embeds: [embed] });
    return;
  }

  if (sub === "exercise") {
    await interaction.deferReply();
    const name = interaction.options.getString("name", true);
    const template = await findTemplateByTitle(guildId, name);
    if (!template) {
      await interaction.editReply("Exercise not found.");
      return;
    }

    async function bests(uid: string) {
      const rows = await db
        .select()
        .from(workoutsCache)
        .where(and(eq(workoutsCache.guildId, guildId!), eq(workoutsCache.discordUserId, uid)));
      let weight = 0;
      let e1rm = 0;
      let volume = 0;
      for (const row of rows) {
        const w = parseWorkout(row);
        for (const e of w.exercises) {
          if (e.exercise_template_id !== template!.id) continue;
          weight = Math.max(weight, exerciseBestWeight(e));
          e1rm = Math.max(e1rm, exerciseBestE1rm(e));
          volume = Math.max(volume, exerciseSessionVolume(e));
        }
      }
      return { weight, e1rm, volume };
    }

    const ba = await bests(a.id);
    const bb = await bests(b.id);
    const unit = ((await getLink(guildId, a.id))?.weightUnit as "kg" | "lbs") ?? "kg";

    const embed = new EmbedBuilder()
      .setColor(0x9b59b6)
      .setTitle(`Compare · ${template.title}`)
      .addFields(
        {
          name: a.username,
          value: `Best: **${formatWeight(ba.weight, unit)}**\ne1RM: **${formatWeight(ba.e1rm, unit)}**\nBest volume: **${formatWeight(ba.volume, unit)}**`,
          inline: true,
        },
        {
          name: b.username,
          value: `Best: **${formatWeight(bb.weight, unit)}**\ne1RM: **${formatWeight(bb.e1rm, unit)}**\nBest volume: **${formatWeight(bb.volume, unit)}**`,
          inline: true,
        },
      );
    await interaction.editReply({ embeds: [embed] });
  }
}

export async function handlePr(interaction: ChatInputCommandInteraction) {
  const guildId = await requireGuild(interaction);
  if (!guildId) return;
  const user = interaction.options.getUser("user") ?? interaction.user;
  const limit = interaction.options.getInteger("limit") ?? 10;

  const rows = await db
    .select()
    .from(workoutsCache)
    .where(and(eq(workoutsCache.guildId, guildId), eq(workoutsCache.discordUserId, user.id)));

  if (!rows.length) {
    await interaction.reply({
      content: `No cached workouts for <@${user.id}>. Link with \`/hevy link\` and wait for a poll.`,
      ephemeral: true,
    });
    return;
  }

  const bestByExercise = new Map<string, { title: string; e1rm: number; weight: number }>();
  for (const row of rows) {
    const w = parseWorkout(row);
    for (const e of w.exercises) {
      const e1rm = exerciseBestE1rm(e);
      const weight = exerciseBestWeight(e);
      if (e1rm <= 0 && weight <= 0) continue;
      const cur = bestByExercise.get(e.exercise_template_id);
      if (!cur || e1rm > cur.e1rm) {
        bestByExercise.set(e.exercise_template_id, { title: e.title, e1rm, weight });
      }
    }
  }

  const unit = ((await getLink(guildId, user.id))?.weightUnit as "kg" | "lbs") ?? "kg";
  const ranked = [...bestByExercise.values()]
    .sort((a, b) => b.e1rm - a.e1rm)
    .slice(0, limit)
    .map(
      (r, i) =>
        `**${i + 1}.** ${r.title} — ${formatWeight(r.weight, unit)} (e1RM ~${formatWeight(r.e1rm, unit)})`,
    )
    .join("\n");

  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle(`PRs — ${user.username}`)
    .setDescription(ranked || "_None_");
  await interaction.reply({ embeds: [embed] });
}
