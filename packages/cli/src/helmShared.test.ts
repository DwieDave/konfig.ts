import { describe, expect, it } from "@effect/vitest"
import { Effect, Exit } from "effect"
import fc from "fast-check"
import { ConfigNotFound } from "./configResolver"
import { toChartRef, toExtractOptions } from "./helmShared"

const word = fc.stringMatching(/^[a-z0-9.-]{1,12}$/)

describe("helmShared", () => {
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
          digest
        })
        expect(toExtractOptions({ entry: { id, repo, chart, version }, outDir, cacheDir }).digest).toBeUndefined()
        expect(toChartRef({ entry, cacheDir })).toEqual({ repo, chart, version, cacheDir, digest })
      })
    )
  })

  it.effect("ConfigNotFound is recoverable", () =>
    Effect.gen(function*() {
      const exit = yield* Effect.exit(
        Effect.fail(new ConfigNotFound({ startedFrom: "." })).pipe(
          Effect.catchTag("ConfigNotFound", () => Effect.succeed("missing"))
        )
      )

      expect(Exit.isSuccess(exit)).toBe(true)
    }))
})
