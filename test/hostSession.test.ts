import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  decideAfterAttachFailure,
  forgetHost,
  migrateLegacyHost,
  pruneHosts,
  readLastHost,
  retryDelayMs,
  saveHost,
} from "../client/src/hostSession.ts"

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

describe("host session storage", () => {
  it("saves a session and reads the last one", () => {
    const s = fakeStorage()
    assert.equal(readLastHost(s), null)
    saveHost(s, { code: "ABCD", hostToken: "tok1" }, 1000)
    saveHost(s, { code: "WXYZ", hostToken: "tok2" }, 2000)
    assert.deepEqual(readLastHost(s), { code: "WXYZ", hostToken: "tok2", savedAt: 2000 })
    assert.deepEqual(s.keys(), ["fq:host:ABCD", "fq:host:WXYZ", "fq:host:last"])
  })

  it("ignores a last pointer without a valid entry", () => {
    assert.equal(readLastHost(fakeStorage({ "fq:host:last": '"ABCD"' })), null)
    assert.equal(readLastHost(fakeStorage({ "fq:host:last": '"ABCD"', "fq:host:ABCD": "{not json" })), null)
    assert.equal(readLastHost(fakeStorage({ "fq:host:last": '"ABCD"', "fq:host:ABCD": '{"code":"ABCD"}' })), null)
  })

  it("forgets an entry and clears last only when it points to it", () => {
    const s = fakeStorage()
    saveHost(s, { code: "ABCD", hostToken: "a" }, 1)
    saveHost(s, { code: "WXYZ", hostToken: "b" }, 2)
    forgetHost(s, "ABCD")
    assert.equal(readLastHost(s)?.code, "WXYZ")
    assert.deepEqual(s.keys(), ["fq:host:WXYZ", "fq:host:last"])
    forgetHost(s, "WXYZ")
    assert.deepEqual(s.keys(), [])
    assert.equal(readLastHost(s), null)
  })

  it("moves the legacy sessionStorage entry once", () => {
    const local = fakeStorage()
    const session = fakeStorage({ "friends-quiz-host": JSON.stringify({ code: "QRST", hostToken: "old" }) })
    migrateLegacyHost(local, session, 5000)
    assert.deepEqual(readLastHost(local), { code: "QRST", hostToken: "old", savedAt: 5000 })
    assert.deepEqual(session.keys(), [])
    migrateLegacyHost(local, session, 6000)
    assert.equal(readLastHost(local)?.savedAt, 5000)
  })

  it("does not overwrite a newer local session and drops garbage", () => {
    const local = fakeStorage()
    saveHost(local, { code: "NEWW", hostToken: "n" }, 1)
    const session = fakeStorage({ "friends-quiz-host": JSON.stringify({ code: "QRST", hostToken: "old" }) })
    migrateLegacyHost(local, session, 2)
    assert.equal(readLastHost(local)?.code, "NEWW")
    assert.deepEqual(session.keys(), [])
    const junk = fakeStorage({ "friends-quiz-host": "nope" })
    migrateLegacyHost(local, junk, 3)
    assert.deepEqual(junk.keys(), [])
  })

  it("prunes sessions older than the room lifetime plus a day", () => {
    const day = 86_400_000
    const now = 10 * day
    const s = fakeStorage()
    saveHost(s, { code: "OLDD", hostToken: "a" }, now - 4 * day)
    saveHost(s, { code: "FRSH", hostToken: "b" }, now - day)
    pruneHosts(s, now)
    assert.deepEqual(s.keys(), ["fq:host:FRSH", "fq:host:last"])
  })
})

describe("attach failure", () => {
  it("discards the session only when the room is gone", () => {
    assert.equal(decideAfterAttachFailure("room_not_found"), "discard")
    for (const code of ["no_reply", "unreachable", "reconnecting", "server_error", "rate_limited", "rejoin"]) {
      assert.equal(decideAfterAttachFailure(code), "retry", code)
    }
  })

  it("backs off 1, 2, 4, 8 seconds and then every 15", () => {
    assert.deepEqual([0, 1, 2, 3, 4, 5, 20].map(retryDelayMs), [1000, 2000, 4000, 8000, 15000, 15000, 15000])
  })
})
