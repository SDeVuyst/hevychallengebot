export interface HevyUserInfo {
  id: string;
  username: string;
  name?: string | null;
  url?: string | null;
  weight_unit?: "kg" | "lbs";
  distance_unit?: string;
  is_pro?: boolean;
}

export interface HevySet {
  index: number;
  type: "normal" | "warmup" | "dropset" | "failure" | string;
  weight_kg: number | null;
  reps: number | null;
  distance_meters: number | null;
  duration_seconds: number | null;
  rpe: number | null;
  custom_metric: number | null;
}

export interface HevyExercise {
  index: number;
  title: string;
  notes?: string | null;
  exercise_template_id: string;
  superset_id?: number | null;
  sets: HevySet[];
}

export interface HevyWorkout {
  id: string;
  title: string;
  description?: string | null;
  start_time: string;
  end_time: string;
  created_at?: string;
  updated_at?: string;
  routine_id?: string | null;
  exercises: HevyExercise[];
}

export interface HevyWorkoutEvent {
  type: "updated" | "deleted";
  workout?: HevyWorkout;
  id?: string;
  deleted_at?: string;
}

export interface HevyExerciseTemplate {
  id: string;
  title: string;
  type?: string;
  primary_muscle_group?: string;
  secondary_muscle_groups?: string[];
  is_custom?: boolean;
}

export interface Paginated<T> {
  page: number;
  page_count: number;
  [key: string]: unknown;
}

export interface HevyExerciseHistoryEntry {
  workout_id?: string;
  workout_title?: string;
  exercise_template_id?: string;
  sets?: HevySet[];
  weight_kg?: number | null;
  reps?: number | null;
}
