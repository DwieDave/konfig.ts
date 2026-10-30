import { NodeServices } from "@effect/platform-node"
import { stubSpawner } from "@konfig.ts/core/testing"
import { SecretSource } from "@konfig.ts/env"
import { Effect, Layer } from "effect"
import * as fc from "fast-check"
import { expect, it } from "vitest"
import { Sops } from "./backend"

const word = fc.stringMatching(/^[a-z]{1,6}$/)

const _failure = (input: { readonly name: string; readonly namespace: string }) =>
  Effect.flip(
    Sops.backend({ recipients: {} }).emit({ ...input, keys: ["k"], source: SecretSource.literal({ data: { k: "v" } }) })
      .render({ env: "prod" })
  ).pipe(
    Effect.scoped,
    Effect.provide(Layer.merge(NodeServices.layer, stubSpawner({ respond: () => ({ exitCode: 2 }) })))
  )

const _passthroughFailure = (input: { readonly name: string; readonly namespace: string }) =>
  Effect.flip(
    Sops.passthrough({ file: "/nonexistent/sops.yaml" }).emit({ ...input, keys: ["k"], source: undefined }).render({
      env: "prod"
    })
  ).pipe(Effect.scoped, Effect.provide(NodeServices.layer))

it("Sops labels emit failures with tag(namespace/name)", () =>
  fc.assert(
    fc.asyncProperty(word, word, async (namespace, name) => {
      const error = await Effect.runPromise(_failure({ name, namespace }))

      expect(error.message).toBe(`Sops(${namespace}/${name}): sops failed`)
    })
  ))

it("Sops.passthrough labels emit failures with tag(namespace/name)", () =>
  fc.assert(
    fc.asyncProperty(word, word, async (namespace, name) => {
      const error = await Effect.runPromise(_passthroughFailure({ name, namespace }))

      expect(error.message).toContain(`Sops.passthrough(${namespace}/${name}): could not read`)
    })
  ))
