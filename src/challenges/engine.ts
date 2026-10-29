import { and, asc, eq } from "drizzle-orm";
import { EmbedBuilder, type Client, type TextChannel } from "discord.js";
import { db } from "../db/client.js";
import {
  challengeExercises,
  challengeProgress,
  challengeScores,
  challengeTargets,
  challenges,
  guildSettings,
  type Metric,
} from "../db/schema.js";
import type { HevyWorkout } from "../hevy/types.js";
import { describeTarget, evaluateTarget } from "../util/metrics.js";
import { nowIso } from "../util/time.js";

export interface ProgressHit {
  challengeId: number;
  challengeName: string;
  exerciseId: number;
  exerciseTitle: string;
  tier: number;
  metric: Metric;
  valueAchieved: number;
  previousBonus: number;
  newBonus: number;
  previousTotal: number;
  newTotal: number;
  tookLead: boolean;
}

export function computeScore(
  exerciseIds: number[],
  progressRows: { challengeExerciseId: number; tier: number }[],
): { tierPoints: number; bonusPoints: number; totalPoints: number; tiersHit: number } {
  const byExercise = new Map<number, number>();
  for (const id of exerciseIds) byExercise.set(id, 0);
  for (const p of progressRows) {
    const cur = byExercise.get(p.challengeExerciseId) ?? 0;
    byExercise.set(p.challengeExerciseId, Math.max(cur, p.tier));
  }
  // tier points = count of tiers hit (each tier 1..n counts as 1)
  let tierPoints = 0;
  const depths: number[] = [];
  for (const id of exerciseIds) {
    const depth = byExercise.get(id) ?? 0;
    depths.push(depth);
    tierPoints += depth;
  }
  const minDepth = depths.length ? Math.min(...depths) : 0;
  const bonusPoints = minDepth;
  return {
    tierPoints,
    bonusPoints,
    totalPoints: tierPoints + bonusPoints,
    tiersHit: tierPoints,
  };
}

export async function recomputeScore(challengeId: number, discordUserId: string) {
  const exercises = await db
    .select()
    .from(challengeExercises)
    .where(eq(challengeExercises.challengeId, challengeId));
  const progress = await db
    .select()
    .from(challengeProgress)
    .where(
      and(
        eq(challengeProgress.challengeId, challengeId),
        eq(challengeProgress.discordUserId, discordUserId),
      ),
    );
  const score = computeScore(
    exercises.map((e) => e.id),
    progress.map((p) => ({ challengeExerciseId: p.challengeExerciseId, tier: p.tier })),
  );
  const now = nowIso();
  await db
    .insert(challengeScores)
    .values({
      challengeId,
      discordUserId,
      tierPoints: score.tierPoints,
      bonusPoints: score.bonusPoints,
      totalPoints: score.totalPoints,
      tiersHit: score.tiersHit,
      scoreUpdatedAt: now,
    })
    .onConflictDoUpdate({
      target: [challengeScores.challengeId, challengeScores.discordUserId],
      set: {
        tierPoints: score.tierPoints,
        bonusPoints: score.bonusPoints,
        totalPoints: score.totalPoints,
        tiersHit: score.tiersHit,
        scoreUpdatedAt: now,
      },
    });
  return score;
}

async function currentLeader(challengeId: number): Promise<string | null> {
  const rows = await db
    .select()
    .from(challengeScores)
    .where(eq(challengeScores.challengeId, challengeId))
    .orderBy(asc(challengeScores.scoreUpdatedAt));
  if (!rows.length) return null;
  rows.sort((a, b) => {
    if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;
    return a.scoreUpdatedAt.localeCompare(b.scoreUpdatedAt);
  });
  return rows[0]?.discordUserId ?? null;
}

export async function claimTier(opts: {
  challengeId: number;
  challengeExerciseId: number;
  discordUserId: string;
  tier: number;
  source: "auto" | "manual";
  achievedAt: string;
  workoutId?: string | null;
  valueAchieved?: number | null;
  notes?: string | null;
}): Promise<boolean> {
  // require previous tier if tier > 1
  if (opts.tier > 1) {
    const prev = await db
      .select()
      .from(challengeProgress)
      .where(
        and(
          eq(challengeProgress.challengeId, opts.challengeId),
          eq(challengeProgress.challengeExerciseId, opts.challengeExerciseId),
          eq(challengeProgress.discordUserId, opts.discordUserId),
          eq(challengeProgress.tier, opts.tier - 1),
        ),
      );
    if (!prev.length) return false;
  }

  try {
    await db.insert(challengeProgress).values({
      challengeId: opts.challengeId,
      challengeExerciseId: opts.challengeExerciseId,
      discordUserId: opts.discordUserId,
      tier: opts.tier,
      achievedAt: opts.achievedAt,
      source: opts.source,
      workoutId: opts.workoutId ?? null,
      valueAchieved: opts.valueAchieved ?? null,
      notes: opts.notes ?? null,
    });
  } catch {
    return false; // already claimed
  }
  return true;
}

export async function evaluateWorkoutForChallenges(
  guildId: string,
  discordUserId: string,
  workout: HevyWorkout,
): Promise<ProgressHit[]> {
  const active = await db
    .select()
    .from(challenges)
    .where(and(eq(challenges.guildId, guildId), eq(challenges.status, "active")));

  const hits: ProgressHit[] = [];

  for (const challenge of active) {
    const exercises = await db
      .select()
      .from(challengeExercises)
      .where(eq(challengeExercises.challengeId, challenge.id))
      .orderBy(asc(challengeExercises.sortOrder));

    let beforeLeader = await currentLeader(challenge.id);
    const beforeScore = await db
      .select()
      .from(challengeScores)
      .where(
        and(
          eq(challengeScores.challengeId, challenge.id),
          eq(challengeScores.discordUserId, discordUserId),
        ),
      );
    let previousBonus = beforeScore[0]?.bonusPoints ?? 0;
    let previousTotal = beforeScore[0]?.totalPoints ?? 0;

    for (const ex of exercises) {
      const targets = await db
        .select()
        .from(challengeTargets)
        .where(eq(challengeTargets.challengeExerciseId, ex.id))
        .orderBy(asc(challengeTargets.tier));

      const existing = await db
        .select()
        .from(challengeProgress)
        .where(
          and(
            eq(challengeProgress.challengeId, challenge.id),
            eq(challengeProgress.challengeExerciseId, ex.id),
            eq(challengeProgress.discordUserId, discordUserId),
          ),
        );
      const claimed = new Set(existing.map((p) => p.tier));

      for (const target of targets) {
        if (claimed.has(target.tier)) continue;
        // sequential tiers
        if (target.tier > 1 && !claimed.has(target.tier - 1)) break;

        const value = evaluateTarget(
          workout,
          ex.exerciseTemplateId,
          target.metric as Metric,
          target.targetValue,
          target.targetSecondary,
        );
        if (value == null) break;

        const ok = await claimTier({
          challengeId: challenge.id,
          challengeExerciseId: ex.id,
          discordUserId,
          tier: target.tier,
          source: "auto",
          achievedAt: workout.end_time || nowIso(),
          workoutId: workout.id,
          valueAchieved: value,
        });
        if (!ok) break;
        claimed.add(target.tier);

        const after = await recomputeScore(challenge.id, discordUserId);
        const afterLeader = await currentLeader(challenge.id);
        const tookLead = afterLeader === discordUserId && beforeLeader !== discordUserId;
        hits.push({
          challengeId: challenge.id,
          challengeName: challenge.name,
          exerciseId: ex.id,
          exerciseTitle: ex.title,
          tier: target.tier,
          metric: target.metric as Metric,
          valueAchieved: value,
          previousBonus,
          newBonus: after.bonusPoints,
          previousTotal,
          newTotal: after.totalPoints,
          tookLead,
        });
        previousBonus = after.bonusPoints;
        previousTotal = after.totalPoints;
        if (tookLead) beforeLeader = discordUserId;
      }
    }

    // ensure score row exists even if no new hits this workout
    await recomputeScore(challenge.id, discordUserId);
  }

  return hits;
}

const lastLeaderAnnounce = new Map<string, number>();

export async function announceProgressHits(
  client: Client,
  guildId: string,
  discordUserId: string,
  hits: ProgressHit[],
  weightUnit: "kg" | "lbs" = "kg",
) {
  if (!hits.length) return;
  const settings = await db
    .select()
    .from(guildSettings)
    .where(eq(guildSettings.guildId, guildId));
  const channelId = settings[0]?.challengeChannelId ?? settings[0]?.notifyChannelId;
  if (!channelId) return;

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return;

  for (const hit of hits) {
    const targetRows = await db
      .select()
      .from(challengeTargets)
      .where(eq(challengeTargets.challengeExerciseId, hit.exerciseId));
    const target = targetRows.find((t) => t.tier === hit.tier);
    const targetDesc = target
      ? describeTarget(target.metric as Metric, target.targetValue, target.targetSecondary, weightUnit)
      : `tier ${hit.tier}`;

    const embed = new EmbedBuilder()
      .setColor(0xf1c40f)
      .setTitle(`${hit.challengeName}: tier ${hit.tier} unlocked`)
      .setDescription(
        `<@${discordUserId}> hit **${hit.exerciseTitle}** — ${targetDesc}\n` +
          `Score: **${hit.newTotal}** (tiers ${hit.newTotal - hit.newBonus} + bonus ${hit.newBonus})`,
      )
      .setTimestamp(new Date());

    await (channel as TextChannel).send({ embeds: [embed] }).catch(() => undefined);

    if (hit.newBonus > hit.previousBonus) {
      const bonusEmbed = new EmbedBuilder()
        .setColor(0x9b59b6)
        .setDescription(
          `<@${discordUserId}> unlocked **bonus depth ${hit.newBonus}** in **${hit.challengeName}** (full row across all exercises)!`,
        );
      await (channel as TextChannel).send({ embeds: [bonusEmbed] }).catch(() => undefined);
    }

    if (hit.tookLead) {
      const key = `${guildId}:${hit.challengeId}`;
      const last = lastLeaderAnnounce.get(key) ?? 0;
      if (Date.now() - last > 60_000) {
        lastLeaderAnnounce.set(key, Date.now());
        const leadEmbed = new EmbedBuilder()
          .setColor(0xe74c3c)
          .setDescription(`🏆 <@${discordUserId}> takes the lead in **${hit.challengeName}** with **${hit.newTotal}** points!`);
        await (channel as TextChannel).send({ embeds: [leadEmbed] }).catch(() => undefined);
      }
    }
  }
}

export async function getActiveChallenge(guildId: string, name?: string | null) {
  if (name) {
    const rows = await db
      .select()
      .from(challenges)
      .where(and(eq(challenges.guildId, guildId), eq(challenges.name, name)));
    return rows[0] ?? null;
  }
  const active = await db
    .select()
    .from(challenges)
    .where(and(eq(challenges.guildId, guildId), eq(challenges.status, "active")));
  return active[0] ?? null;
}
