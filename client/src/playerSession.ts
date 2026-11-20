import type { PlayerSession, PublicPlayer } from "@shared/types"
import { pruneOlderThan, readJson, removeKey, writeJson } from "./storage"
import { fmt, formatPoints, t } from "./strings"

/** The player session of one room, as kept in localStorage. */
export interface StoredPlayer extends PlayerSession {
  savedAt: number
}

type Reader = Pick<Storage, "getItem">
type Writer = Pick<Storage, "getItem" | "setItem" | "removeItem">
type Pruner = Pick<Storage, "length" | "key" | "getItem" | "removeItem">

const PREFIX = "fq:player:"
const LAST_KEY = `${PREFIX}last`
const LEGACY_KEY = "friends-quiz-player"

/** A room is deleted after two days idle; sessions are kept one day longer. */
const PLAYER_KEEP_MS = 2 * 24 * 3_600_000 + 86_400_000

const playerKey = (code: string) => `${PREFIX}${code}`

function isStoredPlayer(value: unknown): value is StoredPlayer {
  if (value == null || typeof value !== "object") return false
  const v = value as Partial<StoredPlayer>
  return (
    typeof v.code === "string" &&
    v.code !== "" &&
    typeof v.playerId === "string" &&
    v.playerId !== "" &&
    typeof v.token === "string" &&
    v.token !== ""
  )
}

export function readPlayerFor(s: Reader | null, code: string): StoredPlayer | null {
  const entry = readJson<unknown>(s, playerKey(code))
  return isStoredPlayer(entry) ? entry : null
}

export function readLastPlayer(s: Reader | null): StoredPlayer | null {
  const last = readJson<unknown>(s, LAST_KEY)
  if (typeof last !== "string" || last === "") return null
  return readPlayerFor(s, last)
}

/** With a code in the link, only that room's session counts; without one, the last room's. */
export function chooseSession(s: Reader | null, urlCode: string): StoredPlayer | null {
  return urlCode ? readPlayerFor(s, urlCode) : readLastPlayer(s)
}

export function savePlayer(s: Writer | null, session: PlayerSession, now: number): void {
  const entry: StoredPlayer = {
    code: session.code,
    playerId: session.playerId,
    token: session.token,
    name: session.name,
    savedAt: now,
  }
  writeJson(s, playerKey(session.code), entry)
  writeJson(s, LAST_KEY, session.code)
}

export function forgetPlayer(s: Writer | null, code: string): void {
  removeKey(s, playerKey(code))
  if (readJson<unknown>(s, LAST_KEY) === code) removeKey(s, LAST_KEY)
}

/** Moves the old sessionStorage entry into the new keys, once. */
export function migrateLegacyPlayer(local: Writer | null, session: Writer | null, now = Date.now()): void {
  let raw: string | null = null
  try {
    raw = session?.getItem(LEGACY_KEY) ?? null
  } catch {
    return
  }
  if (raw == null) return
  const legacy = readJson<unknown>(session, LEGACY_KEY)
  if (isStoredPlayer(legacy) && readPlayerFor(local, legacy.code) == null) savePlayer(local, legacy, now)
  removeKey(session, LEGACY_KEY)
}

export function prunePlayers(s: Pruner | null, now: number): void {
  pruneOlderThan(s, PREFIX, PLAYER_KEEP_MS, now)
}

/** "3. miejsce · 250 pkt do lidera", "You're in the lead" or "Tied for first", from the competition ranks. */
export function placeText(players: readonly PublicPlayer[], myId: string): string | null {
  const me = players.find((player) => player.id === myId)
  if (!me) return null
  const inGame = players.filter((player) => !player.left)
  const leader = inGame.reduce((max, player) => Math.max(max, player.score), 0)
  if (me.rank === 1) {
    return inGame.some((player) => player.id !== myId && player.rank === 1) ? t.tiedFirst : t.youLead
  }
  return fmt(t.placeGap, { rank: me.rank, gap: formatPoints(leader - me.score) })
}
