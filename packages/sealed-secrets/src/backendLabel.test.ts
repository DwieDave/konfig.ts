import { NodeServices } from "@effect/platform-node"
import { RenderError } from "@konfig.ts/core"
import { stubSpawner } from "@konfig.ts/core/testing"
import { SecretSource } from "@konfig.ts/env"
import { Effect, Layer } from "effect"
import * as fc from "fast-check"
import { expect, it } from "vitest"
import { SealedSecrets } from "./backend"
import { KubesealInvocationError } from "./kubeseal"

const word = fc.stringMatching(/^[a-z]{1,6}$/)

it("SealedSecrets labels emit failures with tag(namespace/name)", () =>
  fc.assert(
    fc.asyncProperty(word, word, async (namespace, name) => {
      const error = await Effect.runPromise(
        Effect.flip(
          SealedSecrets.backend({ certPath: "/c.pem" }).emit({
            name,
            namespace,
            keys: ["k"],
            source: SecretSource.literal({ data: { k: "v" } })
          }).render({ env: "prod" })
        ).pipe(
          Effect.scoped,
          Effect.provide(Layer.merge(NodeServices.layer, stubSpawner({ respond: () => ({ exitCode: 2 }) })))
        )
      )

      expect(error.message).toBe(`SealedSecrets(${namespace}/${name}): kubeseal failed`)
      expect(error instanceof RenderError ? error.cause : undefined).toBeInstanceOf(KubesealInvocationError)
    })
  ))

it("SealedSecrets labels schema mismatches", async () => {
  const stdout = "apiVersion: bitnami.com/v1alpha1\nkind: NotASealedSecret\nmetadata:\n  name: x\n"

  const error = await Effect.runPromise(
    Effect.flip(
      SealedSecrets.backend({ certPath: "/c.pem" }).emit({
        name: "n",
        namespace: "ns",
        keys: ["k"],
        source: SecretSource.literal({ data: { k: "v" } })
      }).render({ env: "prod" })
    ).pipe(
      Effect.scoped,
      Effect.provide(Layer.merge(NodeServices.layer, stubSpawner({ respond: () => ({ stdout }) })))
    )
  )

  expect(error).toBeInstanceOf(RenderError)
  expect(error.message.startsWith("SealedSecrets(ns/n): kubeseal output did not match SealedSecret")).toBe(true)
})
