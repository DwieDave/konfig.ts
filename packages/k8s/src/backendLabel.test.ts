import { NodeServices } from "@effect/platform-node"
import { SecretSource, SecretSourceError } from "@konfig.ts/env"
import { Effect } from "effect"
import * as fc from "fast-check"
import { it } from "vitest"
import { NativeSecret } from "./nativeSecret"

const word = fc.stringMatching(/^[a-z]{1,6}$/)

const failingSource = (key: string) => ({
  ...SecretSource.literal({ data: {} }),
  keys: [key],
  resolve: Effect.fail(new SecretSourceError({ source: "t", key, cause: "x" }))
})

it("NativeSecret labels emit failures with tag(namespace/name)", () =>
  fc.assert(
    fc.asyncProperty(word, word, async (namespace, name) => {
      const message = await Effect.runPromise(
        NativeSecret.backend({ silenceWarning: true }).emit({
          name,
          namespace,
          keys: ["k"],
          source: failingSource("k")
        }).render({ env: "prod" }).pipe(
          Effect.flip,
          Effect.map((error) => error.message),
          Effect.scoped,
          Effect.provide(NodeServices.layer)
        )
      )

      return message.startsWith(`NativeSecret(${namespace}/${name}): `)
    })
  ))
