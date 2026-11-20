import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { pruneOlderThan, readJson, removeKey, writeJson } from "../client/src/storage.ts"

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
    keys: () => [...map.keys()],
  }
}

describe("storage helpers", () => {
  it("prunes stale entries and keeps fresh ones and pointers", () => {
    const s = fakeStorage({
      "fq:player:AAAA": JSON.stringify({ savedAt: 1_000 }),
      "fq:player:BBBB": JSON.stringify({ savedAt: 9_500 }),
      "fq:player:last": JSON.stringify("BBBB"),
      "fq:player:cnt": "12",
      "other:CCCC": JSON.stringify({ savedAt: 0 }),
    })
    pruneOlderThan(s, "fq:player:", 5_000, 10_000)
    assert.deepEqual(s.keys().sort(), ["fq:player:BBBB", "fq:player:cnt", "fq:player:last", "other:CCCC"])
  })

  it("returns null for garbage or a missing store", () => {
    const s = fakeStorage({ bad: "{not json" })
    assert.equal(readJson(s, "bad"), null)
    assert.equal(readJson(s, "missing"), null)
    assert.equal(readJson(null, "x"), null)
  })

  it("round-trips and removes", () => {
    const s = fakeStorage()
    writeJson(s, "k", { a: 1 })
    assert.deepEqual(readJson(s, "k"), { a: 1 })
    removeKey(s, "k")
    assert.equal(readJson(s, "k"), null)
  })

  it("swallows storage errors", () => {
    const broken = {
      getItem: () => {
        throw new Error("blocked")
      },
      setItem: () => {
        throw new Error("blocked")
      },
      removeItem: () => {
        throw new Error("blocked")
      },
    }
    assert.equal(readJson(broken, "k"), null)
    assert.doesNotThrow(() => writeJson(broken, "k", 1))
    assert.doesNotThrow(() => removeKey(broken, "k"))
  })
})
