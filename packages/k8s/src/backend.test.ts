import { NodeServices } from "@effect/platform-node"
import { RenderError } from "@konfig.ts/core"
import { SecretSource, SecretSourceError } from "@konfig.ts/env"
import { Effect, Redacted } from "effect"
import * as fc from "fast-check"
import { it } from "vitest"
import { type BackendEmitInput, resolvePlaintext } from "./backend"

const word = fc.stringMatching(/^[a-z]{1,6}$/)

const baseOf = (keys: ReadonlyArray<string>, resolve: SecretSource<string>["resolve"]) => unsafeBase({ keys, resolve })

const unsafeBase = (input: {
  readonly keys: ReadonlyArray<string>
  readonly resolve: SecretSource<string>["resolve"]
}): BackendEmitInput<"n", string, true> => ({
  name: "n",
  namespace: "ns",
  keys: input.keys,
  source: { ...SecretSource.literal({ data: {} }), resolve: input.resolve, keys: input.keys }
})

it("failing source maps to RenderError with label and key", () =>
  fc.assert(
    fc.asyncProperty(word, word, async (label, key) => {
      const base = baseOf([key], Effect.fail(new SecretSourceError({ source: "t", key, cause: "x" })))

      const err = await Effect.runPromise(
        Effect.flip(resolvePlaintext({ base, label })).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
      )

      return err instanceof RenderError && err.message === `${label}: source failed for key "${key}"`
    })
  ))

it("succeeding source yields only base.keys as plaintext", () =>
  fc.assert(
    fc.asyncProperty(fc.uniqueArray(word, { minLength: 1 }), word, async (keys, extra) => {
      const all = [...keys, `${extra}_extra`]
      const resolved = Object.fromEntries(all.map((k) => [k, Redacted.make(`v-${k}`)]))
      const base = baseOf(keys, Effect.succeed(resolved))

      const out = await Effect.runPromise(
        resolvePlaintext({ base, label: "l" }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
      )

      return JSON.stringify(out) === JSON.stringify(Object.fromEntries(keys.map((k) => [k, `v-${k}`])))
    })
  ))
