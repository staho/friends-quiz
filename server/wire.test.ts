import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { parseClientMessage } from "../shared/wire.ts"

describe("client messages", () => {
  it("accepts a host attach", () => {
    const message = parseClientMessage({
      id: "1",
      event: "host:attach",
      payload: { code: "quiz", hostToken: "token" },
    })
    assert.deepEqual(message, {
      id: "1",
      event: "host:attach",
      payload: { code: "quiz", hostToken: "token" },
    })
  })

  it("accepts a lock with no payload", () => {
    assert.deepEqual(parseClientMessage({ id: "1", event: "player:lock" }), {
      id: "1",
      event: "player:lock",
    })
  })

  it("rejects a choose without an answer", () => {
    assert.equal(parseClientMessage({ id: "1", event: "player:choose", payload: {} }), null)
  })

  it("rejects an unknown event", () => {
    assert.equal(parseClientMessage({ id: "1", event: "host:create" }), null)
  })
})
