import { sqliteTable, text, integer, real, uniqueIndex, index } from "drizzle-orm/sqlite-core";

export const guildSettings = sqliteTable("guild_settings", {
  guildId: text("guild_id").primaryKey(),
  notifyChannelId: text("notify_channel_id"),
  challengeChannelId: text("challenge_channel_id"),
  pollEnabled: integer("poll_enabled", { mode: "boolean" }).notNull().default(true),
  weightUnit: text("weight_unit").notNull().default("kg"), // kg | lbs
});

export const userLinks = sqliteTable(
  "user_links",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    guildId: text("guild_id").notNull(),
    discordUserId: text("discord_user_id").notNull(),
    hevyApiKeyEnc: text("hevy_api_key_enc").notNull(),
    hevyUserId: text("hevy_user_id"),
    hevyUsername: text("hevy_username"),
    hevyName: text("hevy_name"),
    weightUnit: text("weight_unit").default("kg"),
    lastPolledAt: text("last_polled_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [uniqueIndex("user_links_guild_user").on(t.guildId, t.discordUserId)],
);

export const workoutsCache = sqliteTable(
  "workouts_cache",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    guildId: text("guild_id").notNull(),
    discordUserId: text("discord_user_id").notNull(),
    hevyWorkoutId: text("hevy_workout_id").notNull(),
    title: text("title").notNull(),
    startTime: text("start_time"),
    endTime: text("end_time"),
    notified: integer("notified", { mode: "boolean" }).notNull().default(false),
    payloadJson: text("payload_json").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("workouts_cache_unique").on(t.guildId, t.discordUserId, t.hevyWorkoutId),
    index("workouts_cache_user").on(t.guildId, t.discordUserId),
  ],
);

export const challenges = sqliteTable(
  "challenges",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    guildId: text("guild_id").notNull(),
    name: text("name").notNull(),
    status: text("status").notNull().default("draft"), // draft | active | closed
    createdBy: text("created_by").notNull(),
    startsAt: text("starts_at"),
    endsAt: text("ends_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [uniqueIndex("challenges_guild_name").on(t.guildId, t.name)],
);

export const challengeExercises = sqliteTable(
  "challenge_exercises",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    challengeId: integer("challenge_id")
      .notNull()
      .references(() => challenges.id, { onDelete: "cascade" }),
    exerciseTemplateId: text("exercise_template_id").notNull(),
    title: text("title").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [uniqueIndex("challenge_exercises_unique").on(t.challengeId, t.exerciseTemplateId)],
);

/** metric: weight_reps | e1rm | session_volume | reps | duration */
export const challengeTargets = sqliteTable(
  "challenge_targets",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    challengeExerciseId: integer("challenge_exercise_id")
      .notNull()
      .references(() => challengeExercises.id, { onDelete: "cascade" }),
    tier: integer("tier").notNull(), // 1..5
    metric: text("metric").notNull(),
    targetValue: real("target_value").notNull(),
    targetSecondary: real("target_secondary"), // e.g. reps for weight_reps
  },
  (t) => [uniqueIndex("challenge_targets_unique").on(t.challengeExerciseId, t.tier)],
);

export const challengeProgress = sqliteTable(
  "challenge_progress",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    challengeId: integer("challenge_id")
      .notNull()
      .references(() => challenges.id, { onDelete: "cascade" }),
    challengeExerciseId: integer("challenge_exercise_id")
      .notNull()
      .references(() => challengeExercises.id, { onDelete: "cascade" }),
    discordUserId: text("discord_user_id").notNull(),
    tier: integer("tier").notNull(),
    achievedAt: text("achieved_at").notNull(),
    source: text("source").notNull(), // auto | manual
    workoutId: text("workout_id"),
    valueAchieved: real("value_achieved"),
    notes: text("notes"),
  },
  (t) => [
    uniqueIndex("challenge_progress_unique").on(
      t.challengeId,
      t.challengeExerciseId,
      t.discordUserId,
      t.tier,
    ),
  ],
);

export const challengeScores = sqliteTable(
  "challenge_scores",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    challengeId: integer("challenge_id")
      .notNull()
      .references(() => challenges.id, { onDelete: "cascade" }),
    discordUserId: text("discord_user_id").notNull(),
    tierPoints: integer("tier_points").notNull().default(0),
    bonusPoints: integer("bonus_points").notNull().default(0),
    totalPoints: integer("total_points").notNull().default(0),
    tiersHit: integer("tiers_hit").notNull().default(0),
    scoreUpdatedAt: text("score_updated_at").notNull(),
  },
  (t) => [uniqueIndex("challenge_scores_unique").on(t.challengeId, t.discordUserId)],
);

export type Metric =
  | "weight_reps"
  | "e1rm"
  | "session_volume"
  | "reps"
  | "duration";
