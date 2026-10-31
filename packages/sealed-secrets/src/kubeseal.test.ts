import { it } from "@effect/vitest"
import { BoundaryDecodeError } from "@konfig.ts/core"
import { plainArgs, stdinAsString, stubSpawner } from "@konfig.ts/core/testing"
import { ConfigProvider, Effect, Layer } from "effect"
import type { StandardCommand } from "effect/process/ChildProcess"
import * as fc from "fast-check"
import { describe, expect } from "vitest"
import {
  KubesealCertMissing,
  KubesealInvocationError,
  KubesealParseError,
  resolveCertPath,
  runKubeseal,
  type RunKubesealInput
} from "./kubeseal"

const SEALED = `
apiVersion: bitnami.com/v1alpha1
kind: SealedSecret
metadata:
  name: db-creds
  namespace: prod
spec:
  encryptedData:
    url: AgB7nF9stub==
`.trim()

const _env = (env: Record<string, string>) => ConfigProvider.layer(ConfigProvider.fromEnv({ env }))

const INPUT: RunKubesealInput = { plainSecretYaml: "kind: Secret\n", certPath: "/c.pem", scope: "cluster-wide" }

const _seal = (proc: { readonly stdout?: string; readonly exitCode?: number; readonly stderr?: string }) =>
  runKubeseal(INPUT).pipe(Effect.provide(stubSpawner({ respond: () => proc })))

describe("resolveCertPath", () => {
  it.effect("prefers a non-empty certPath over $KUBESEAL_CERT", () =>
    Effect.gen(function*() {
      const path = yield* resolveCertPath({ certPath: "/opt.pem" }).pipe(
        Effect.provide(_env({ KUBESEAL_CERT: "/env.pem" }))
      )

      expect(path).toBe("/opt.pem")
    }))

  it.effect("falls back to $KUBESEAL_CERT when certPath is omitted or empty", () =>
    Effect.gen(function*() {
      const omitted = yield* resolveCertPath({}).pipe(Effect.provide(_env({ KUBESEAL_CERT: "/env.pem" })))
      const empty = yield* resolveCertPath({ certPath: "" }).pipe(Effect.provide(_env({ KUBESEAL_CERT: "/env.pem" })))

      expect([omitted, empty]).toEqual(["/env.pem", "/env.pem"])
    }))

  it.effect("fails with KubesealCertMissing when neither is set", () =>
    Effect.gen(function*() {
      const error = yield* Effect.flip(resolveCertPath({}).pipe(Effect.provide(_env({ KUBESEAL_CERT: "" }))))

      expect(error).toBeInstanceOf(KubesealCertMissing)
      expect(error.message).toContain("pass opts.certPath or set $KUBESEAL_CERT")
    }))
})

describe("runKubeseal", () => {
  it.effect("pipes the Secret YAML on stdin with cert, scope and yaml format, decoding the SealedSecret", () =>
    Effect.gen(function*() {
      const calls: Array<{ readonly cmd: StandardCommand; readonly stdin: string }> = []

      const sealed = yield* runKubeseal(INPUT).pipe(
        Effect.provide(
          stubSpawner({
            respond: () => ({ stdout: SEALED }),
            sink: (cmd) => stdinAsString(cmd).pipe(Effect.map((stdin) => void calls.push({ cmd, stdin })))
          })
        )
      )

      expect(sealed.spec.encryptedData).toEqual({ url: "AgB7nF9stub==" })
      expect(calls.map(({ cmd }) => [cmd.command, ...plainArgs(cmd)])).toEqual([
        ["kubeseal", "--cert", "/c.pem", "--scope", "cluster-wide", "--format", "yaml"]
      ])
      expect(calls.map(({ stdin }) => stdin)).toEqual(["kind: Secret\n"])
    }))

  it.effect("a failing kubeseal is KubesealInvocationError carrying the exit detail", () =>
    Effect.gen(function*() {
      const error = yield* Effect.flip(_seal({ exitCode: 1, stderr: "cannot fetch cert\n" }))

      expect(error).toBeInstanceOf(KubesealInvocationError)
      expect(error.message).toBe("kubeseal invocation failed (exit 1): cannot fetch cert")
    }))

  it.effect("output that is not YAML is KubesealParseError carrying the raw output", () =>
    Effect.gen(function*() {
      const error = yield* Effect.flip(_seal({ stdout: "key: [1,2" }))

      expect(error).toBeInstanceOf(KubesealParseError)
      expect(error instanceof KubesealParseError ? error.output : undefined).toBe("key: [1,2")
    }))

  it.effect("YAML that is not a SealedSecret is BoundaryDecodeError", () =>
    Effect.gen(function*() {
      const error = yield* Effect.flip(_seal({ stdout: "apiVersion: v1\nkind: Secret\n" }))

      expect(error).toBeInstanceOf(BoundaryDecodeError)
      expect(error.message).toContain("SealedSecret")
    }))

  it("passes any cert path through verbatim as one argv entry", () =>
    fc.assert(
      fc.asyncProperty(fc.string({ minLength: 1 }), async (certPath) => {
        const argv: Array<ReadonlyArray<string>> = []

        await Effect.runPromise(
          runKubeseal({ ...INPUT, certPath }).pipe(
            Effect.provide(
              Layer.merge(
                stubSpawner({
                  respond: () => ({ stdout: SEALED }),
                  sink: (cmd) => Effect.sync(() => void argv.push(plainArgs(cmd)))
                }),
                _env({})
              )
            )
          )
        )

        expect(argv[0]?.[1]).toBe(certPath)
      })
    ))
})
