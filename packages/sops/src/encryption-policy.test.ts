import { it } from "@effect/vitest"
import { Effect } from "effect"
import * as fc from "fast-check"
import { describe, expect } from "vitest"
import { compilePolicy, mustEncrypt, type SopsMetadata } from "./encryption-policy"

const _segment = fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9_]{0,10}$/)
const _path = fc.array(_segment, { minLength: 1, maxLength: 5 })

const _policy = (sops: SopsMetadata) => compilePolicy({ sops, label: "t" })

describe("encryption policy", () => {
  it.effect("no recorded rule means every path must be encrypted", () =>
    Effect.gen(function*() {
      const policy = yield* _policy({})
      fc.assert(fc.property(_path, (path) => mustEncrypt({ policy, path })))
    }))

  it.effect("encrypted_regex requires encryption iff some segment matches", () =>
    Effect.gen(function*() {
      const policy = yield* _policy({ encrypted_regex: "^(data|stringData)$" })
      fc.assert(fc.property(_path, (path) =>
        mustEncrypt({ policy, path }) === path.some((s) =>
          s === "data" || s === "stringData"
        )))
    }))

  it.effect("unencrypted_regex exempts iff some segment matches", () =>
    Effect.gen(function*() {
      const policy = yield* _policy({ unencrypted_regex: "^pub" })
      fc.assert(fc.property(_path, (path) => mustEncrypt({ policy, path }) === !path.some((s) => s.startsWith("pub"))))
    }))

  it.effect("encrypted_suffix requires encryption iff some segment has the suffix", () =>
    Effect.gen(function*() {
      const policy = yield* _policy({ encrypted_suffix: "_secret" })
      fc.assert(fc.property(_path, (path) => mustEncrypt({ policy, path }) === path.some((s) => s.endsWith("_secret"))))
    }))

  it.effect("unencrypted_suffix exempts iff some segment has the suffix", () =>
    Effect.gen(function*() {
      const policy = yield* _policy({ unencrypted_suffix: "_plain" })
      fc.assert(fc.property(_path, (path) => mustEncrypt({ policy, path }) === !path.some((s) => s.endsWith("_plain"))))
    }))

  it.effect("combined rules are fail-closed: encrypted when any rule demands it", () =>
    Effect.gen(function*() {
      const policy = yield* _policy({ encrypted_suffix: "_a", unencrypted_suffix: "_b" })
      fc.assert(fc.property(_path, (path) => {
        const demands = path.some((s) => s.endsWith("_a")) || !path.some((s) => s.endsWith("_b"))

        return mustEncrypt({ policy, path }) === demands
      }))
    }))

  it.effect("rejects an invalid regex", () =>
    Effect.gen(function*() {
      const exit = yield* Effect.exit(_policy({ unencrypted_regex: "(" }))
      expect(exit._tag).toBe("Failure")
    }))
})
