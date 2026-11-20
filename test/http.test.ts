import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { clientKey, parseRoomPath } from "../server/http.ts"

describe("parseRoomPath", () => {
  it("rejects a bad percent escape instead of throwing", () => {
    assert.equal(parseRoomPath("%E0"), null)
  })
  it("upper-cases a valid code", () => {
    assert.equal(parseRoomPath("abcd"), "ABCD")
    assert.equal(parseRoomPath(" abcd "), "ABCD")
  })
  it("rejects the wrong length and letters outside the alphabet", () => {
    assert.equal(parseRoomPath("ABCDE"), null)
    assert.equal(parseRoomPath("I0OO"), null)
  })
})

describe("clientKey", () => {
  it("uses the connecting IP, else local", () => {
    assert.equal(clientKey(new Request("http://x/", { headers: { "CF-Connecting-IP": "1.2.3.4" } })), "1.2.3.4")
    assert.equal(clientKey(new Request("http://x/")), "local")
  })
})
