import { Cause, Effect, Exit } from "effect"
import fc from "fast-check"
import { describe, expect, it } from "vitest"
import { diffFiles, parseYamlAll } from "./diff"
import { parseYamlWith, stringRecordSchema } from "./yamlSchema"

const _failsWith = <A, E>(effect: Effect.Effect<A, E>): boolean => {
  const exit = Effect.runSyncExit(effect)

  return Exit.isFailure(exit) && Cause.pretty(exit.cause).includes("YamlParseError")
}

describe("parseYamlAll failure modes", () => {
  it("fails on malformed, mixed and duplicate-key documents", () => {
    for (const bad of ["a: [", "- a\nb: c", "a: 1\na: 2\n"]) expect(_failsWith(parseYamlAll(bad))).toBe(true)
  })

  it("property: an injected syntax error always fails", () => {
    const key = fc.stringMatching(/^[a-z]{1,8}$/)
    fc.assert(
      fc.property(key, key, (a, b) => {
        expect(_failsWith(parseYamlAll(`${a}: 1\n---\n${b}: [\n`))).toBe(true)
      })
    )
  })

  it("property: well-formed single-key docs parse", () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[a-z]{1,8}$/), fc.integer(), (k, v) => {
        expect(Effect.runSync(parseYamlAll(`${k}: ${v}\n`))).toEqual([{ [k]: v }])
      })
    )
  })

  it("diffFiles fails on a corrupt side", () => {
    expect(_failsWith(diffFiles({ left: { "f.yaml": "a: [" }, right: { "f.yaml": "a: 1" } }))).toBe(true)
  })
})

describe("parseYamlWith", () => {
  it("decodes against the schema and maps failures through onError", () => {
    const run = (text: string) =>
      Effect.runSyncExit(parseYamlWith({ text, schema: stringRecordSchema, onError: (c) => String(c) }))

    expect(run("a: b\n")).toEqual(Exit.succeed({ a: "b" }))
    expect(Exit.isFailure(run("a: 1\n"))).toBe(true)
  })

  it("applies onError exactly once on a syntax error", () => {
    const calls: Array<unknown> = []

    const onError = (cause: unknown) => {
      calls.push(cause)

      return { wrapped: cause }
    }

    const exit = Effect.runSyncExit(parseYamlWith({ text: "a: [", schema: stringRecordSchema, onError }))

    expect(calls).toHaveLength(1)
    expect(Exit.isFailure(exit) && Cause.squash(exit.cause)).toEqual({ wrapped: calls[0] })
  })
})
