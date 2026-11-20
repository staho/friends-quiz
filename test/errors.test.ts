import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { errorCode, errorText } from "../client/src/errors.ts"
import { ERROR_CODES, isErrorCode } from "../shared/errors.ts"
import { GameError } from "../server/game.ts"

describe("error codes", () => {
  it("maps every code to non-empty text with no leftover placeholders", () => {
    for (const code of ERROR_CODES) {
      const text = errorText(code)
      assert.ok(text.length > 0, code)
      assert.doesNotMatch(text, /[{}]/, code)
    }
  })

  it("fills the time ranges from the constants", () => {
    assert.match(errorText("answer_time_range"), /5.*120/)
    assert.match(errorText("next_time_range"), /2.*30/)
  })

  it("accepts known codes and rejects everything else", () => {
    assert.equal(isErrorCode("name_taken"), true)
    assert.equal(isErrorCode("That name is taken"), false)
    assert.equal(isErrorCode(undefined), false)
    assert.equal(isErrorCode(4), false)
  })

  it("falls back to the generic text for unknown codes", () => {
    assert.equal(errorText("nope"), errorText("server_error"))
    assert.equal(errorCode(new Error("x")), "server_error")
  })

  it("carries the code on a GameError", () => {
    const error = new GameError("name_taken")
    assert.equal(error.code, "name_taken")
    assert.equal(error.message, "name_taken")
    assert.equal(errorCode(error), "name_taken")
  })
})
