import { NodeServices } from "@effect/platform-node"
import { stubSpawner } from "@konfig.ts/core/testing"
import { SecretSource } from "@konfig.ts/env"
import { Effect, Layer } from "effect"
import * as fc from "fast-check"
import { expect, it } from "vitest"
import { SealedSecrets } from "./backend"

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
    })
  ))
