import { Effect, Exit, Schema } from "effect"
import { describe, expect, it } from "vitest"
import { decodeField, RepoScriptError } from "./repo"

describe("decodeField", () => {
  it("decodes a valid value", async () => {
    const out = await Effect.runPromise(
      decodeField({ schema: Schema.String, value: "ok", what: "name" })
    )
    expect(out).toBe("ok")
  })

  it("fails with RepoScriptError on an invalid value", async () => {
    const exit = await Effect.runPromiseExit(
      decodeField({ schema: Schema.String, value: 1, what: "name" })
    )
    expect(Exit.isFailure(exit)).toBe(true)
    const err = Exit.isFailure(exit) ? JSON.stringify(exit.cause) : ""
    expect(err).toContain("unexpected shape for name")
    expect(new RepoScriptError({ message: "x" })._tag).toBe("RepoScriptError")
  })
})
