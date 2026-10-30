import { NodeServices } from "@effect/platform-node"
import { Manifest, RenderError } from "@konfig.ts/core"
import { stubSpawner } from "@konfig.ts/core/testing"
import { SecretSource, SecretSourceError } from "@konfig.ts/env"
import { Effect, Redacted } from "effect"
import * as fc from "fast-check"
import { expect, it } from "vitest"
import {
  type BackendEmitInput,
  decodeYamlOutput,
  encryptVia,
  encryptWithCli,
  plainSecret,
  resolvePlaintext,
  SecretBackend,
  secretMeta
} from "./backend"
import * as K8s from "./index"

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

it("SecretBackend.make carries tag, requiresSource and emit", () => {
  fc.assert(fc.property(word, fc.boolean(), (tag, requiresSource) => {
    const backend = SecretBackend.make({ tag, requiresSource, emit: () => Manifest.make(() => Effect.succeed({})) })
    expect(backend._tag).toBe(tag)
    expect(backend.requiresSource).toBe(requiresSource)
  }))
})

it("SecretBackend.make computes the label from tag and base for emit", () => {
  fc.assert(fc.property(word, word, word, (tag, name, namespace) => {
    const seen: string[] = []
    const base = { ...baseOf(["k"], Effect.succeed({})), name, namespace }

    SecretBackend.make({
      tag,
      requiresSource: true,
      emit: (input) => {
        seen.push(input.label)

        return Manifest.make(() => Effect.succeed({}))
      }
    }).emit(base)
    expect(seen).toEqual([`${tag}(${namespace}/${name})`])
  }))
})

it("resolvePlaintext stays internal to the k8s package", () => {
  expect("resolvePlaintext" in K8s).toBe(false)
})

it("encryptWithCli fails RenderError with label and bin on non-zero exit", async () => {
  const err = await Effect.runPromise(
    Effect.flip(encryptWithCli({ bin: "tool", args: ["-x"], stdin: "in", label: "L(ns/n)" })).pipe(
      Effect.provide(stubSpawner({ respond: () => ({ exitCode: 2, stderr: "boom" }) }))
    )
  )

  expect(err).toBeInstanceOf(RenderError)
  expect(err.message).toBe("L(ns/n): tool failed")
  expect(err.cause).toBeDefined()
})

it("decodeYamlOutput reports invalid YAML with label", async () => {
  const err = await Effect.runPromise(
    Effect.flip(
      decodeYamlOutput<string, never, never>({
        text: "a: [",
        label: "LBL",
        what: "tool",
        decode: () => Effect.succeed("x")
      })
    )
  )

  expect(err).toBeInstanceOf(RenderError)
  expect(err.message).toContain("LBL")
  expect(err.message).toContain("not valid YAML")
})

it("plainSecret derives from the emit base", () => {
  fc.assert(fc.property(word, word, word, (tag, name, namespace) => {
    const base: BackendEmitInput<string, string, true> = { ...baseOf(["k"], Effect.succeed({})), name, namespace }
    expect(secretMeta(base)).toMatchObject({ name, namespace })
    expect(plainSecret({ base, stringData: { k: "v" } })).toMatchObject({
      kind: "Secret",
      metadata: { name, namespace }
    })
  }))
})

it("encryptVia threads resolved plaintext through toPlain, encrypt and verify", () =>
  fc.assert(
    fc.asyncProperty(word, word, async (key, value) => {
      const base = baseOf([key], Effect.succeed({ [key]: Redacted.make(`v-${value}`) }))

      const out = await Effect.runPromise(
        encryptVia({
          base,
          label: "l",
          toPlain: (stringData) => ({ stringData }),
          encrypt: (yaml) => Effect.succeed(`enc(${yaml})`),
          verify: (output) => Effect.succeed(output)
        }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
      )

      return out.startsWith("enc(") && out.includes(`: v-${value}`)
    })
  ))
