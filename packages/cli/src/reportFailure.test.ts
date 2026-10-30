import { describe, expect, it } from "@effect/vitest"
import { Data } from "effect"
import fc from "fast-check"
import { _errorLine } from "./reportFailure"

class EnvLoadError extends Data.TaggedError("EnvLoadError")<{
  readonly entry: string
  readonly cause: unknown
}> {}

const _tagged = (tag: string, fields: Record<string, string | Error>): Error =>
  Object.assign(new Error(""), fields, { _tag: tag })

describe("_errorLine", () => {
  it("keeps the cause message when the error has none", () => {
    const line = _errorLine(new EnvLoadError({ entry: "/x/prod.ts", cause: new SyntaxError("Unexpected token") }))
    expect(line).toContain("Unexpected token")
    expect(line).toContain("entry=/x/prod.ts")
  })

  it("stringifies non-Error causes", () => {
    expect(_errorLine(new EnvLoadError({ entry: "e", cause: "boom" }))).toContain("boom")
  })

  it("property: line contains the tag and the Error cause message", () => {
    const tag = fc.stringMatching(/^[A-Z][A-Za-z]{2,12}$/)
    const msg = fc.string({ minLength: 1 }).filter((m) => m.trim().length > 0)
    fc.assert(
      fc.property(
        tag,
        fc.dictionary(fc.stringMatching(/^k[a-z]{0,7}$/), fc.string(), { maxKeys: 3 }),
        msg,
        (t, fields, m) => {
          const line = _errorLine(_tagged(t, { ...fields, cause: new Error(m) }))
          expect(line).toContain(t)
          expect(line).toContain(m)
        }
      )
    )
  })
})
