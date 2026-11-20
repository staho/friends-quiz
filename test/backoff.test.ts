import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { reconnectDelay } from "../client/src/backoff.ts"

describe("reconnectDelay", () => {
  it("stays within 0.8x to 1.2x of the base sequence", () => {
    const base = [500, 1000, 2000, 4000, 8000, 10000]
    base.forEach((b, i) => {
      assert.equal(Math.round(reconnectDelay(i, () => 0)), b * 0.8)
      assert.equal(Math.round(reconnectDelay(i, () => 1)), b * 1.2)
    })
  })
  it("is capped at 12000 ms however many attempts failed", () => {
    for (const attempt of [5, 6, 20, 1000]) assert.ok(reconnectDelay(attempt, () => 1) <= 12000 + 1e-6)
    assert.equal(Math.round(reconnectDelay(1000, () => 1)), 12000)
  })
  it("does not decrease with a fixed rng", () => {
    let last = 0
    for (let i = 0; i < 12; i++) {
      const d = reconnectDelay(i, () => 0.5)
      assert.ok(d >= last)
      last = d
    }
  })
})
