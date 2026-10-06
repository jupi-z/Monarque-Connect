const BACKOFF_SECONDS = [1, 5, 30, 120, 300] as const;

export function nextRetryAt(attempt: number, now = new Date()): Date {
  const seconds = BACKOFF_SECONDS[Math.min(Math.max(attempt, 1) - 1, BACKOFF_SECONDS.length - 1)] ?? 300;
  return new Date(now.getTime() + seconds * 1000);
}
