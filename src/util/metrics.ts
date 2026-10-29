import type { HevyExercise, HevySet, HevyWorkout } from "../hevy/types.js";
import type { Metric } from "../db/schema.js";

export function isWorkingSet(set: HevySet): boolean {
  return set.type !== "warmup";
}

/** Epley estimated 1RM */
export function estimated1rm(weightKg: number, reps: number): number {
  if (reps <= 0 || weightKg <= 0) return 0;
  if (reps === 1) return weightKg;
  return weightKg * (1 + reps / 30);
}

export function setVolume(set: HevySet): number {
  const w = set.weight_kg ?? 0;
  const r = set.reps ?? 0;
  return w * r;
}

export function exerciseSessionVolume(exercise: HevyExercise): number {
  return exercise.sets.filter(isWorkingSet).reduce((sum, s) => sum + setVolume(s), 0);
}

export function exerciseBestE1rm(exercise: HevyExercise): number {
  let best = 0;
  for (const s of exercise.sets.filter(isWorkingSet)) {
    if (s.weight_kg != null && s.reps != null) {
      best = Math.max(best, estimated1rm(s.weight_kg, s.reps));
    }
  }
  return best;
}

export function exerciseBestWeight(exercise: HevyExercise): number {
  let best = 0;
  for (const s of exercise.sets.filter(isWorkingSet)) {
    if (s.weight_kg != null) best = Math.max(best, s.weight_kg);
  }
  return best;
}

export function workoutTotalVolume(workout: HevyWorkout): number {
  return workout.exercises.reduce((sum, e) => sum + exerciseSessionVolume(e), 0);
}

export function formatWeight(kg: number, unit: "kg" | "lbs" = "kg"): string {
  if (unit === "lbs") {
    return `${Math.round(kg * 2.2046226218 * 10) / 10} lb`;
  }
  return `${Math.round(kg * 10) / 10} kg`;
}

/**
 * Check whether a workout achieves a challenge target for a given exercise template.
 * Returns the achieved numeric value if met, else null.
 */
export function evaluateTarget(
  workout: HevyWorkout,
  exerciseTemplateId: string,
  metric: Metric,
  targetValue: number,
  targetSecondary: number | null | undefined,
): number | null {
  const exercises = workout.exercises.filter((e) => e.exercise_template_id === exerciseTemplateId);
  if (!exercises.length) return null;

  switch (metric) {
    case "weight_reps": {
      const minWeight = targetValue;
      const minReps = targetSecondary ?? 1;
      let best: number | null = null;
      for (const ex of exercises) {
        for (const s of ex.sets.filter(isWorkingSet)) {
          if (s.weight_kg != null && s.reps != null && s.weight_kg >= minWeight && s.reps >= minReps) {
            const score = s.weight_kg;
            if (best == null || score > best) best = score;
          }
        }
      }
      return best;
    }
    case "e1rm": {
      let best = 0;
      for (const ex of exercises) best = Math.max(best, exerciseBestE1rm(ex));
      return best >= targetValue ? best : null;
    }
    case "session_volume": {
      const vol = exercises.reduce((sum, e) => sum + exerciseSessionVolume(e), 0);
      return vol >= targetValue ? vol : null;
    }
    case "reps": {
      // Prefer a single-set hit; fall back to session total
      let bestSet = 0;
      let session = 0;
      for (const ex of exercises) {
        for (const s of ex.sets.filter(isWorkingSet)) {
          const r = s.reps ?? 0;
          bestSet = Math.max(bestSet, r);
          session += r;
        }
      }
      if (bestSet >= targetValue) return bestSet;
      if (session >= targetValue) return session;
      return null;
    }
    case "duration": {
      let best = 0;
      let session = 0;
      for (const ex of exercises) {
        for (const s of ex.sets.filter(isWorkingSet)) {
          const d = s.duration_seconds ?? 0;
          best = Math.max(best, d);
          session += d;
        }
      }
      if (best >= targetValue) return best;
      if (session >= targetValue) return session;
      return null;
    }
    default:
      return null;
  }
}

export function describeTarget(
  metric: Metric,
  targetValue: number,
  targetSecondary: number | null | undefined,
  unit: "kg" | "lbs" = "kg",
): string {
  switch (metric) {
    case "weight_reps":
      return `${formatWeight(targetValue, unit)} × ${targetSecondary ?? 1} reps`;
    case "e1rm":
      return `e1RM ≥ ${formatWeight(targetValue, unit)}`;
    case "session_volume":
      return `session volume ≥ ${formatWeight(targetValue, unit)}`;
    case "reps":
      return `≥ ${targetValue} reps`;
    case "duration":
      return `≥ ${targetValue}s`;
    default:
      return String(targetValue);
  }
}
