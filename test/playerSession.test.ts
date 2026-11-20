import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  chooseSession,
  forgetPlayer,
  migrateLegacyPlayer,
  placeText,
  prunePlayers,
  readLastPlayer,
  readPlayerFor,
  savePlayer,
} from "../client/src/playerSession.ts"
import { NBSP } from "../client/src/strings.ts"
import type { PublicPlayer } from "../shared/types.ts"

function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial))
  return {
    get length() {
      return map.size
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    keys: () => [...map.keys()].sort(),
  }
}

const ann = { code: "ABCD", playerId: "p1", token: "t1", name: "Ania" }
const bob = { code: "WXYZ", playerId: "p2", token: "t2", name: "Bartek" }

describe("player session storage", () => {
  it("chooses by the code in the link, else the last player", () => {
    const s = fakeStorage()
    savePlayer(s, ann, 1000)
    savePlayer(s, bob, 2000)
    assert.equal(chooseSession(s, "ABCD")?.playerId, "p1")
    assert.equal(chooseSession(s, "WXYZ")?.playerId, "p2")
    assert.equal(chooseSession(s, "QQQQ"), null)
    assert.equal(chooseSession(s, "")?.playerId, "p2")
    assert.deepEqual(readLastPlayer(s), { ...bob, savedAt: 2000 })
  })

  it("forgets one room and its last pointer", () => {
    const s = fakeStorage()
    savePlayer(s, ann, 1000)
    savePlayer(s, bob, 2000)
    forgetPlayer(s, "WXYZ")
    assert.equal(readLastPlayer(s), null)
    assert.equal(readPlayerFor(s, "ABCD")?.name, "Ania")
    assert.deepEqual(s.keys(), ["fq:player:ABCD"])
  })

  it("ignores a broken entry", () => {
    const s = fakeStorage({ "fq:player:last": '"ABCD"', "fq:player:ABCD": '{"code":"ABCD"}' })
    assert.equal(readLastPlayer(s), null)
  })

  it("migrates the legacy sessionStorage entry once", () => {
    const local = fakeStorage()
    const session = fakeStorage({ "friends-quiz-player": JSON.stringify(ann) })
    migrateLegacyPlayer(local, session, 5000)
    assert.deepEqual(readPlayerFor(local, "ABCD"), { ...ann, savedAt: 5000 })
    assert.equal(readLastPlayer(local)?.code, "ABCD")
    assert.equal(session.getItem("friends-quiz-player"), null)
  })

  it("prunes sessions older than three days", () => {
    const s = fakeStorage()
    savePlayer(s, ann, 0)
    savePlayer(s, bob, 3 * 86_400_000)
    prunePlayers(s, 3 * 86_400_000 + 1000)
    assert.equal(readPlayerFor(s, "ABCD"), null)
    assert.equal(readPlayerFor(s, "WXYZ")?.name, "Bartek")
  })
})

function player(id: string, score: number, rank: number): PublicPlayer {
  return { id, name: id, score, rank, previousRank: null, left: false } as unknown as PublicPlayer
}

describe("placeText", () => {
  it("says you lead when alone on top", () => {
    assert.equal(placeText([player("a", 900, 1), player("b", 400, 2)], "a"), `1.${NBSP}miejsce · prowadzisz`)
  })
  it("says tied for first", () => {
    assert.equal(placeText([player("a", 900, 1), player("b", 900, 1)], "b"), `1.${NBSP}miejsce${NBSP}ex${NBSP}aequo`)
  })
  it("shows place and the gap to the leader", () => {
    const players = [player("a", 900, 1), player("b", 700, 2), player("c", 650, 3)]
    assert.equal(placeText(players, "c"), `3.${NBSP}miejsce · 250${NBSP}pkt${NBSP}do${NBSP}lidera`)
  })
  it("shares a place on a tie below the lead", () => {
    const players = [player("a", 900, 1), player("b", 500, 2), player("c", 500, 2)]
    assert.equal(placeText(players, "b"), placeText(players, "c"))
  })
  it("wraps only at the separator on a narrow phone", () => {
    const players = [player("a", 2000, 1), player("b", 784, 2)]
    const line = placeText(players, "b") ?? ""
    assert.equal(line, `2.${NBSP}miejsce · 1${NBSP}216${NBSP}pkt${NBSP}do${NBSP}lidera`)
    assert.deepEqual(line.split(" "), [`2.${NBSP}miejsce`, "·", `1${NBSP}216${NBSP}pkt${NBSP}do${NBSP}lidera`])
  })
  it("ignores a player who left when finding the leader", () => {
    const players = [{ ...player("a", 2000, 0), left: true }, player("b", 900, 1), player("c", 400, 2)]
    assert.equal(placeText(players, "b"), `1.${NBSP}miejsce · prowadzisz`)
    assert.equal(placeText(players, "c"), `2.${NBSP}miejsce · 500${NBSP}pkt${NBSP}do${NBSP}lidera`)
  })
  it("returns null for an unknown player", () => {
    assert.equal(placeText([player("a", 1, 1)], "zz"), null)
  })
})
