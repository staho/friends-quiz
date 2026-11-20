import type { HostSession } from "@shared/types"
import { ROOM_TTL_MS } from "../../shared/types.ts"
import { pruneOlderThan, readJson, removeKey, writeJson } from "./storage"

/** The host session of one room, as kept in localStorage. */
export interface StoredHost extends HostSession {
  savedAt: number
}

type Reader = Pick<Storage, "getItem">
type Writer = Pick<Storage, "getItem" | "setItem" | "removeItem">
type Pruner = Pick<Storage, "length" | "key" | "getItem" | "removeItem">

const PREFIX = "fq:host:"
const LAST_KEY = `${PREFIX}last`
const LEGACY_KEY = "friends-quiz-host"

/** A room is deleted after ROOM_TTL_MS idle; sessions are kept one day longer. */
const HOST_KEEP_MS = ROOM_TTL_MS + 86_400_000

const hostKey = (code: string) => `${PREFIX}${code}`

function isStoredHost(value: unknown): value is StoredHost {
  if (value == null || typeof value !== "object") return false
  const v = value as Partial<StoredHost>
  return typeof v.code === "string" && v.code !== "" && typeof v.hostToken === "string" && v.hostToken !== ""
}

export function readLastHost(s: Reader | null): StoredHost | null {
  const last = readJson<unknown>(s, LAST_KEY)
  if (typeof last !== "string" || last === "") return null
  const entry = readJson<unknown>(s, hostKey(last))
  return isStoredHost(entry) ? entry : null
}

export function saveHost(s: Writer | null, session: HostSession, now: number): void {
  const entry: StoredHost = { code: session.code, hostToken: session.hostToken, savedAt: now }
  writeJson(s, hostKey(session.code), entry)
  writeJson(s, LAST_KEY, session.code)
}

export function forgetHost(s: Writer | null, code: string): void {
  removeKey(s, hostKey(code))
  if (readJson<unknown>(s, LAST_KEY) === code) removeKey(s, LAST_KEY)
}

/** Moves the old sessionStorage entry into the new keys, once. */
export function migrateLegacyHost(local: Writer | null, session: Writer | null, now = Date.now()): void {
  let raw: string | null = null
  try {
    raw = session?.getItem(LEGACY_KEY) ?? null
  } catch {
    return
  }
  if (raw == null) return
  const legacy = readJson<unknown>(session, LEGACY_KEY)
  if (isStoredHost(legacy) && readLastHost(local) == null) saveHost(local, legacy, now)
  removeKey(session, LEGACY_KEY)
}

export function pruneHosts(s: Pruner | null, now: number): void {
  pruneOlderThan(s, PREFIX, HOST_KEEP_MS, now)
}

/** Only a room that is really gone is discarded. A timeout, a blip or a server error keeps the session. */
export function decideAfterAttachFailure(code: string): "discard" | "retry" {
  return code === "room_not_found" ? "discard" : "retry"
}

/** Delay before retry number `attempt` (0-based): 1, 2, 4, 8 s, then every 15 s. */
export function retryDelayMs(attempt: number): number {
  return attempt < 4 ? 1000 * 2 ** attempt : 15_000
}
