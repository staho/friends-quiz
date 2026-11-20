const BASE_MS = [500, 1000, 2000, 4000, 8000, 10000]

/** Delay before reconnect attempt number `attempt` (0-based): 500 ms doubling to 10 s, jittered by 0.8 to 1.2. */
export function reconnectDelay(attempt: number, rng: () => number = Math.random): number {
  const index = Math.min(Math.max(0, Math.trunc(attempt)), BASE_MS.length - 1)
  return BASE_MS[index] * (0.8 + 0.4 * rng())
}
