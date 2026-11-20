/** Storage helpers that never throw: storage can be blocked, full or missing (private mode). */

export function local(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export function readJson<T>(s: Pick<Storage, "getItem"> | null, key: string): T | null {
  if (!s) return null
  try {
    const raw = s.getItem(key)
    return raw == null ? null : (JSON.parse(raw) as T)
  } catch {
    return null
  }
}

export function writeJson(s: Pick<Storage, "setItem"> | null, key: string, value: unknown): void {
  if (!s) return
  try {
    s.setItem(key, JSON.stringify(value))
  } catch {
    // storage blocked or full
  }
}

export function removeKey(s: Pick<Storage, "removeItem"> | null, key: string): void {
  if (!s) return
  try {
    s.removeItem(key)
  } catch {
    // storage blocked
  }
}

/** Removes every `prefix*` entry whose JSON object has a numeric `savedAt` older than `maxAgeMs`. */
export function pruneOlderThan(
  s: Pick<Storage, "length" | "key" | "getItem" | "removeItem"> | null,
  prefix: string,
  maxAgeMs: number,
  now: number,
): void {
  if (!s) return
  try {
    const stale: string[] = []
    for (let i = 0; i < s.length; i++) {
      const key = s.key(i)
      if (key == null || !key.startsWith(prefix)) continue
      const value = readJson<unknown>(s, key)
      if (value == null || typeof value !== "object") continue
      const savedAt = (value as { savedAt?: unknown }).savedAt
      if (typeof savedAt === "number" && now - savedAt > maxAgeMs) stale.push(key)
    }
    for (const key of stale) removeKey(s, key)
  } catch {
    // storage blocked
  }
}
