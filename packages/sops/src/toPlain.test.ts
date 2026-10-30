import { NodeServices } from "@effect/platform-node"
import { Yaml } from "@konfig.ts/core"
import { stdinAsString, stubSpawner } from "@konfig.ts/core/testing"
import { SecretSource } from "@konfig.ts/env"
import { Backend } from "@konfig.ts/k8s"
import { Effect, Layer } from "effect"
import { expect, it } from "vitest"
import { Sops } from "./backend"

it("sends the serialized plain SopsSecret on stdin", async () => {
  const stdins: string[] = []

  await Effect.runPromiseExit(
    Sops.backend({ recipients: {} }).emit({
      name: "n",
      namespace: "ns",
      keys: ["k"],
      source: SecretSource.literal({ data: { k: "v" } })
    }).render({ env: "prod" }).pipe(
      Effect.scoped,
      Effect.provide(
        Layer.merge(
          NodeServices.layer,
          stubSpawner({
            respond: () => ({ stdout: "a: [" }),
            sink: (cmd) => stdinAsString(cmd).pipe(Effect.map((stdin) => void stdins.push(stdin)))
          })
        )
      )
    )
  )

  expect(stdins).toEqual([Yaml.serialize({
    value: {
      apiVersion: "isindir.github.com/v1alpha3",
      kind: "SopsSecret",
      metadata: Backend.secretMeta({ name: "n", namespace: "ns", keys: ["k"], source: undefined }),
      spec: { secretTemplates: [{ name: "n", type: "Opaque", stringData: { k: "v" } }] }
    }
  })])
})
