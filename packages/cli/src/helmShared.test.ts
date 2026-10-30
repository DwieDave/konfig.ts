import { describe, expect, it } from "@effect/vitest"
import { Effect, Exit } from "effect"
import fc from "fast-check"
import { ConfigNotFound } from "./configResolver"
import { digestOf, toExtractOptions } from "./helmShared"

const word = fc.stringMatching(/^[a-z0-9.-]{1,12}$/)

describe("helmShared", () => {
  it("property: digestOf maps empty to undefined and preserves others", () => {
    fc.assert(fc.property(word, (d) => digestOf({ digest: d }) === d))
    expect(digestOf({ digest: "" })).toBeUndefined()
  })

  it("property: toExtractOptions maps every entry field", () => {
    fc.assert(
      fc.property(word, word, word, word, word, word, word, (repo, chart, version, id, digest, outDir, cacheDir) => {
        const entry = { repo, chart, version, id, digest }
        expect(toExtractOptions({ entry, outDir, cacheDir })).toEqual({
          repo,
          chart,
          version,
          id,
          outDir,
          cacheDir,
          digest: digestOf(entry)
        })
        expect(toExtractOptions({ entry: { ...entry, digest: "" }, outDir, cacheDir }).digest).toBeUndefined()
      })
    )
  })

  it.effect("ConfigNotFound becomes undefined", () =>
    Effect.gen(function*() {
      const exit = yield* Effect.exit(
        Effect.fail(new ConfigNotFound({ startedFrom: "." })).pipe(
          Effect.catchTag("ConfigNotFound", () => Effect.succeed(undefined))
        )
      )
      expect(Exit.isSuccess(exit)).toBe(true)
    }))
})
