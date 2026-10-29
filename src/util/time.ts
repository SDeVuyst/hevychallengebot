export function nowIso(): string {
  return new Date().toISOString();
}

export function formatDuration(startIso: string | null | undefined, endIso: string | null | undefined): string {
  if (!startIso || !endIso) return "—";
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Jitter poll so we don't hit xx:00 as Hevy docs suggest. */
export function nextPollDelay(baseMs: number): number {
  const jitter = Math.floor(Math.random() * 60_000);
  let delay = baseMs + jitter;
  const fireAt = Date.now() + delay;
  const d = new Date(fireAt);
  if (d.getMinutes() === 0 && d.getSeconds() < 30) {
    delay += 45_000;
  }
  return delay;
}
