import { NodeServices } from "@effect/platform-node"
import { it as effectIt } from "@effect/vitest"
import { Yaml } from "@konfig.ts/core"
import { stdinAsString, stubSpawner } from "@konfig.ts/core/testing"
import { SecretSource } from "@konfig.ts/env"
import { Backend } from "@konfig.ts/k8s"
import { Cause, Effect, Exit, Fiber, Layer } from "effect"
import { TestClock } from "effect/testing"
import * as fc from "fast-check"
import { describe, expect, it } from "vitest"
import { Sops } from "./backend"

const word = fc.stringMatching(/^[a-z]{1,6}$/)

const _render = (input: {
  readonly name: string
  readonly namespace: string
  readonly timeout?: "5 seconds"
  readonly respond: { readonly stdout?: string; readonly exitCode?: number; readonly hang?: boolean }
  readonly stdins?: string[]
}) =>
  Sops.backend({ recipients: {}, timeout: input.timeout }).emit({
    name: input.name,
    namespace: input.namespace,
    keys: ["k"],
    source: SecretSource.literal({ data: { k: "v" } })
  }).render({ env: "prod" }).pipe(
    Effect.scoped,
    Effect.provide(
      Layer.merge(
        NodeServices.layer,
        stubSpawner({
          respond: () => input.respond,
          sink: (cmd) => stdinAsString(cmd).pipe(Effect.map((stdin) => void input.stdins?.push(stdin)))
        })
      )
    )
  )

describe("Sops encrypting pipeline", () => {
  it("non-zero exit fails with '<label>: sops failed'", () =>
    fc.assert(
      fc.asyncProperty(word, word, async (name, namespace) => {
        const error = await Effect.runPromise(Effect.flip(_render({ name, namespace, respond: { exitCode: 2 } })))

        return error.message === `Sops(${namespace}/${name}): sops failed`
      })
    ))

  it("non-YAML stdout fails with 'output was not valid YAML'", async () => {
    const error = await Effect.runPromise(
      Effect.flip(_render({ name: "n", namespace: "ns", respond: { stdout: "a: [" } }))
    )

    expect(error.message).toContain("Sops(ns/n): ")
    expect(error.message).toContain("output was not valid YAML")
  })

  it("sends the serialized plain CR on stdin", async () => {
    const stdins: string[] = []
    await Effect.runPromiseExit(_render({ name: "n", namespace: "ns", respond: { stdout: "a: [" }, stdins }))

    expect(stdins).toEqual([Yaml.serialize({
      value: {
        apiVersion: "isindir.github.com/v1alpha3",
        kind: "SopsSecret",
        metadata: Backend.secretMeta({ name: "n", namespace: "ns", keys: ["k"], source: undefined }),
        spec: { secretTemplates: [{ name: "n", type: "Opaque", stringData: { k: "v" } }] }
      }
    })])
  })

  effectIt.effect("forwards opts.timeout to the process", () =>
    Effect.gen(function*() {
      const fiber = yield* Effect.forkChild(
        Effect.exit(_render({ name: "n", namespace: "ns", timeout: "5 seconds", respond: { hang: true } }))
      )

      yield* TestClock.adjust("6 seconds")
      const exit = yield* Fiber.join(fiber)

      expect(Exit.isFailure(exit) ? Cause.pretty(exit.cause) : "").toContain("timed out after 5s")
    }))
})
