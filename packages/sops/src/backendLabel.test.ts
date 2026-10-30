import { NodeServices } from "@effect/platform-node"
import { RenderError } from "@konfig.ts/core"
import { stubSpawner } from "@konfig.ts/core/testing"
import { SecretSource } from "@konfig.ts/env"
import { Effect, Layer } from "effect"
import * as fc from "fast-check"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
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

it("Sops.passthrough labels schema mismatches", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sops-pt-"))
  const file = join(dir, "cm.yaml")
  writeFileSync(file, "apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: x\n")

  const error = await Effect.runPromise(
    Effect.flip(
      Sops.passthrough({ file }).emit({ name: "n", namespace: "ns", keys: ["k"], source: undefined }).render({
        env: "prod"
      })
    ).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  )

  expect(error).toBeInstanceOf(RenderError)
  expect(error.message.startsWith("Sops.passthrough(ns/n):")).toBe(true)
})

it("Sops.backend labels invalid recipients", async () => {
  const error = await Effect.runPromise(
    Effect.flip(
      Sops.backend({ recipients: { age: ["not-an-age-key"] } }).emit({
        name: "n",
        namespace: "ns",
        keys: ["k"],
        source: SecretSource.literal({ data: { k: "v" } })
      }).render({ env: "prod" })
    ).pipe(
      Effect.scoped,
      Effect.provide(Layer.merge(NodeServices.layer, stubSpawner({ respond: () => ({ exitCode: 0 }) })))
    )
  )

  expect(error).toBeInstanceOf(RenderError)
  expect(error.message.startsWith("Sops(ns/n):")).toBe(true)
})
