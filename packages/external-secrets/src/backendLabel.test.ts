import { NodeServices } from "@effect/platform-node"
import { Effect } from "effect"
import * as fc from "fast-check"
import { expect, it } from "vitest"
import { ExternalSecrets } from "./backend"

const word = fc.stringMatching(/^[a-z]{1,6}$/)

it("ExternalSecrets labels emit failures with tag(namespace/name)", () =>
  fc.assert(
    fc.asyncProperty(word, word, async (namespace, name) => {
      const error = await Effect.runPromise(
        Effect.flip(
          ExternalSecrets.backend({ secretStoreRef: { name: "s" }, refreshInterval: "1sjunk" }).emit({
            name,
            namespace,
            keys: ["k"],
            source: undefined
          }).render({ env: "prod" })
        ).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
      )

      expect(error.message).toBe(`ExternalSecrets(${namespace}/${name}): invalid refreshInterval`)
    })
  ))
