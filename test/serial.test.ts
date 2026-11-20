import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { createSerialQueue } from "../server/serial.ts"

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe("serial queue", () => {
  it("keeps order when the first task awaits", async () => {
    const run = createSerialQueue()
    const seen: number[] = []
    await Promise.all([
      run(async () => {
        await sleep(50)
        seen.push(1)
      }),
      run(() => {
        seen.push(2)
      }),
      run(async () => {
        seen.push(3)
      }),
    ])
    assert.deepEqual(seen, [1, 2, 3])
  })

  it("does not let a rejected task block the next one", async () => {
    const run = createSerialQueue()
    const failed = run(async () => {
      throw new Error("boom")
    })
    const after = run(() => "ok")
    await assert.rejects(failed, /boom/)
    assert.equal(await after, "ok")
  })

  it("lets End win over a slow Next that was queued first", async () => {
    async function scenario(run: <T>(task: () => Promise<T>) => Promise<T>): Promise<string> {
      let stored = "reveal"
      const next = run(async () => {
        const seen = stored
        await sleep(30)
        if (seen === "reveal") stored = "ready"
      })
      await sleep(5)
      const end = run(async () => {
        stored = "finished"
      })
      await Promise.all([next, end])
      return stored
    }
    const queue = createSerialQueue()
    assert.equal(await scenario((task) => queue(task)), "finished")
    // Control without the queue: the late write of "ready" wins, which is the old bug.
    const raced = await (async () => {
      let stored = "reveal"
      const next = (async () => {
        await sleep(30)
        stored = "ready"
      })()
      await sleep(5)
      const end = (async () => {
        stored = "finished"
      })()
      await Promise.all([next, end])
      return stored
    })()
    assert.equal(raced, "ready")
  })
})
