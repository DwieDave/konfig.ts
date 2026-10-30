import { Effect, Redacted } from "effect"
import * as fc from "fast-check"
import { describe, expect, it } from "vitest"
import { resolveByKey } from "./_record"

describe("resolveByKey", () => {
  it("yields exactly one resolved value per unique key", () =>
    fc.assert(
      fc.asyncProperty(fc.uniqueArray(fc.string({ minLength: 1 })), async (keys) => {
        const out = await Effect.runPromise(
          resolveByKey({ keys, resolve: (key) => Effect.succeed(Redacted.make(key)) })
        )

        expect(Object.keys(out).sort()).toEqual([...keys].sort())

        for (const key of keys) expect(Redacted.value(out[key])).toBe(key)
      })
    ))
})

describe("env barrel", () => {
  it("does not export resolveByKey", async () => {
    const barrel = await import("./index")
    expect("resolveByKey" in barrel).toBe(false)
  })
})
