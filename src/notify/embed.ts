import { EmbedBuilder } from "discord.js";
import type { HevyWorkout } from "../hevy/types.js";
import {
  exerciseBestE1rm,
  exerciseBestWeight,
  formatWeight,
  workoutTotalVolume,
} from "../util/metrics.js";
import { formatDuration } from "../util/time.js";

export function workoutNotifyEmbed(
  workout: HevyWorkout,
  opts: {
    discordUserId: string;
    hevyUsername?: string | null;
    weightUnit?: "kg" | "lbs";
  },
): EmbedBuilder {
  const unit = opts.weightUnit ?? "kg";
  const volume = workoutTotalVolume(workout);
  const duration = formatDuration(workout.start_time, workout.end_time);

  const topLifts = [...workout.exercises]
    .map((e) => ({
      title: e.title,
      weight: exerciseBestWeight(e),
      e1rm: exerciseBestE1rm(e),
    }))
    .filter((x) => x.weight > 0 || x.e1rm > 0)
    .sort((a, b) => b.e1rm - a.e1rm)
    .slice(0, 5)
    .map((x) => `**${x.title}** — ${formatWeight(x.weight, unit)} (e1RM ~${formatWeight(x.e1rm, unit)})`)
    .join("\n");

  const embed = new EmbedBuilder()
    .setColor(0x1db954)
    .setTitle(workout.title || "Workout")
    .setDescription(`New workout from <@${opts.discordUserId}>`)
    .addFields(
      { name: "Duration", value: duration, inline: true },
      { name: "Exercises", value: String(workout.exercises.length), inline: true },
      { name: "Volume", value: formatWeight(volume, unit), inline: true },
    )
    .setTimestamp(workout.end_time ? new Date(workout.end_time) : new Date());

  if (topLifts) {
    embed.addFields({ name: "Top lifts", value: topLifts });
  }

  if (opts.hevyUsername) {
    embed.setURL(`https://hevy.com/user/${opts.hevyUsername}`);
  }

  return embed;
}
