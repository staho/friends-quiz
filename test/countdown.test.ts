import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { nextBoundaryDelay } from "../client/src/useCountdown.ts"

describe("nextBoundaryDelay", () => {
  it("waits until the displayed whole second changes", () => {
    assert.equal(nextBoundaryDelay(3000, 0), 1000)
    assert.equal(nextBoundaryDelay(2500, 0), 500)
    assert.equal(nextBoundaryDelay(3000, 200), 800)
    assert.equal(nextBoundaryDelay(500, 0), 500)
    assert.equal(nextBoundaryDelay(1000, 0), 1000)
  })

  it("is zero when time is up", () => {
    assert.equal(nextBoundaryDelay(0, 0), 0)
    assert.equal(nextBoundaryDelay(100, 200), 0)
  })

  it("lands exactly on the next lower second", () => {
    for (const [remaining, elapsed] of [[9700, 0], [9700, 123], [4000, 1], [1500, 400]]) {
      const delay = nextBoundaryDelay(remaining, elapsed)
      const before = Math.ceil((remaining - elapsed) / 1000)
      const after = Math.ceil((remaining - elapsed - delay) / 1000)
      assert.equal(after, before - 1)
    }
  })
})
