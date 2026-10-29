import type {
  HevyExerciseHistoryEntry,
  HevyExerciseTemplate,
  HevyUserInfo,
  HevyWorkout,
  HevyWorkoutEvent,
} from "./types.js";

const BASE = "https://api.hevyapp.com/v1";

export class HevyApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
    this.name = "HevyApiError";
  }
}

export class HevyClient {
  constructor(private readonly apiKey: string) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        "api-key": this.apiKey,
        Accept: "application/json",
        ...(init?.headers ?? {}),
      },
    });
    const text = await res.text();
    if (!res.ok) {
      throw new HevyApiError(`Hevy API ${res.status}: ${text.slice(0, 200)}`, res.status, text);
    }
    if (!text) return {} as T;
    return JSON.parse(text) as T;
  }

  async getUserInfo(): Promise<HevyUserInfo> {
    const res = await this.request<{ data?: HevyUserInfo } & HevyUserInfo>("/user/info");
    return res.data ?? res;
  }

  async getWorkouts(page = 1, pageSize = 10): Promise<{
    page: number;
    page_count: number;
    workouts: HevyWorkout[];
  }> {
    return this.request(`/workouts?page=${page}&pageSize=${pageSize}`);
  }

  async getWorkout(id: string): Promise<HevyWorkout> {
    return this.request(`/workouts/${id}`);
  }

  async getWorkoutEvents(
    since: string,
    page = 1,
    pageSize = 10,
  ): Promise<{ page: number; page_count: number; events: HevyWorkoutEvent[] }> {
    const q = new URLSearchParams({
      since,
      page: String(page),
      pageSize: String(pageSize),
    });
    return this.request(`/workouts/events?${q}`);
  }

  async getExerciseTemplates(
    page = 1,
    pageSize = 100,
  ): Promise<{ page: number; page_count: number; exercise_templates: HevyExerciseTemplate[] }> {
    return this.request(`/exercise_templates?page=${page}&pageSize=${pageSize}`);
  }

  /** Fetch all pages of exercise templates (cached callers should store result). */
  async getAllExerciseTemplates(): Promise<HevyExerciseTemplate[]> {
    const all: HevyExerciseTemplate[] = [];
    let page = 1;
    let pageCount = 1;
    while (page <= pageCount) {
      const res = await this.getExerciseTemplates(page, 100);
      pageCount = res.page_count;
      all.push(...(res.exercise_templates ?? []));
      page += 1;
    }
    return all;
  }

  async getExerciseHistory(
    exerciseTemplateId: string,
    startDate?: string,
    endDate?: string,
  ): Promise<{ exercise_history?: HevyExerciseHistoryEntry[]; history?: HevyExerciseHistoryEntry[] }> {
    const q = new URLSearchParams();
    if (startDate) q.set("start_date", startDate);
    if (endDate) q.set("end_date", endDate);
    const qs = q.toString();
    return this.request(`/exercise_history/${exerciseTemplateId}${qs ? `?${qs}` : ""}`);
  }
}
