import { and, eq } from "drizzle-orm";
import type { Client, TextChannel } from "discord.js";
import { db } from "../db/client.js";
import { guildSettings, userLinks, workoutsCache } from "../db/schema.js";
import { config } from "../config.js";
import { announceProgressHits, evaluateWorkoutForChallenges } from "../challenges/engine.js";
import { workoutNotifyEmbed } from "../notify/embed.js";
import { nextPollDelay, nowIso, sleep } from "../util/time.js";
import { HevyClient } from "./client.js";
import { decrypt } from "./crypto.js";
import type { HevyWorkout } from "./types.js";

let running = false;

async function processUser(
  client: Client,
  link: typeof userLinks.$inferSelect,
): Promise<void> {
  const settingsRows = await db
    .select()
    .from(guildSettings)
    .where(eq(guildSettings.guildId, link.guildId));
  const settings = settingsRows[0];
  if (settings && settings.pollEnabled === false) return;

  let apiKey: string;
  try {
    apiKey = decrypt(link.hevyApiKeyEnc);
  } catch (e) {
    console.error(`Failed to decrypt key for ${link.discordUserId}:`, e);
    return;
  }

  const hevy = new HevyClient(apiKey);
  const since = link.lastPolledAt ?? new Date(Date.now() - 7 * 24 * 3600_000).toISOString();
  const pollStarted = nowIso();

  let page = 1;
  let pageCount = 1;
  const updated: HevyWorkout[] = [];

  while (page <= pageCount) {
    const res = await hevy.getWorkoutEvents(since, page, 10);
    pageCount = res.page_count || 1;
    for (const event of res.events ?? []) {
      if (event.type === "updated" && event.workout) {
        updated.push(event.workout);
      }
    }
    page += 1;
  }

  // events are newest→oldest; process oldest first for notifications order
  updated.reverse();

  for (const workout of updated) {
    const existing = await db
      .select()
      .from(workoutsCache)
      .where(
        and(
          eq(workoutsCache.guildId, link.guildId),
          eq(workoutsCache.discordUserId, link.discordUserId),
          eq(workoutsCache.hevyWorkoutId, workout.id),
        ),
      );

    const isNew = !existing.length;
    const now = nowIso();

    await db
      .insert(workoutsCache)
      .values({
        guildId: link.guildId,
        discordUserId: link.discordUserId,
        hevyWorkoutId: workout.id,
        title: workout.title,
        startTime: workout.start_time,
        endTime: workout.end_time,
        notified: false,
        payloadJson: JSON.stringify(workout),
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [workoutsCache.guildId, workoutsCache.discordUserId, workoutsCache.hevyWorkoutId],
        set: {
          title: workout.title,
          startTime: workout.start_time,
          endTime: workout.end_time,
          payloadJson: JSON.stringify(workout),
          updatedAt: now,
        },
      });

    if (isNew && settings?.notifyChannelId) {
      const channel = await client.channels.fetch(settings.notifyChannelId).catch(() => null);
      if (channel?.isTextBased()) {
        const embed = workoutNotifyEmbed(workout, {
          discordUserId: link.discordUserId,
          hevyUsername: link.hevyUsername,
          weightUnit: (link.weightUnit as "kg" | "lbs") ?? "kg",
        });
        await (channel as TextChannel).send({ embeds: [embed] }).catch((err) => {
          console.error("Notify send failed:", err);
        });
        await db
          .update(workoutsCache)
          .set({ notified: true })
          .where(
            and(
              eq(workoutsCache.guildId, link.guildId),
              eq(workoutsCache.discordUserId, link.discordUserId),
              eq(workoutsCache.hevyWorkoutId, workout.id),
            ),
          );
      }
    }

    const hits = await evaluateWorkoutForChallenges(link.guildId, link.discordUserId, workout);
    await announceProgressHits(
      client,
      link.guildId,
      link.discordUserId,
      hits,
      (link.weightUnit as "kg" | "lbs") ?? "kg",
    );
  }

  await db
    .update(userLinks)
    .set({ lastPolledAt: pollStarted, updatedAt: nowIso() })
    .where(eq(userLinks.id, link.id));
}

export async function pollOnce(client: Client): Promise<void> {
  if (running) return;
  running = true;
  try {
    const links = await db.select().from(userLinks);
    for (const link of links) {
      try {
        await processUser(client, link);
      } catch (err) {
        console.error(`Poll failed for user ${link.discordUserId} in guild ${link.guildId}:`, err);
      }
      await sleep(500); // gentle pacing between users
    }
  } finally {
    running = false;
  }
}

export function startPoller(client: Client): void {
  const loop = async () => {
    try {
      await pollOnce(client);
    } catch (err) {
      console.error("Poller error:", err);
    }
    const delay = nextPollDelay(config.POLL_INTERVAL_MS);
    setTimeout(loop, delay);
  };
  // initial delay with jitter
  setTimeout(loop, nextPollDelay(5_000));
  console.log("Hevy poller started");
}
