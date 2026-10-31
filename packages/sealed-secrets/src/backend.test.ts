import { NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { RenderError, Yaml } from "@konfig.ts/core"
import { plainArgs, stdinAsString, stubSpawner } from "@konfig.ts/core/testing"
import { SecretSource } from "@konfig.ts/env"
import { Secret } from "@konfig.ts/k8s"
import { Cause, ConfigProvider, Effect, Exit, Fiber, Layer, Schema } from "effect"
import type { StandardCommand } from "effect/process/ChildProcess"
import { TestClock } from "effect/testing"
import * as fc from "fast-check"
import { describe, expect, it as plainIt } from "vitest"
import { SealedSecrets } from "./backend"
import { _kubesealArgs, KubesealCertMissing, KubesealParseError } from "./kubeseal"
import { SealedSecretSchema } from "./schema"

const _asSealedSecret = Schema.decodeUnknownEffect(SealedSecretSchema)

const STUB_SEALED_YAML = `
apiVersion: bitnami.com/v1alpha1
kind: SealedSecret
metadata:
  name: db-creds
  namespace: prod
spec:
  template:
    metadata:
      name: db-creds
      namespace: prod
    type: Opaque
  encryptedData:
    url: AgB7nF9stubUrlEncryptedPayload==
    password: AgC4kL8stubPasswordEncryptedPayload==
`.trim()

interface SpawnerSink {
  lastCmd?: StandardCommand
  lastStdin?: string
}

const _makeStubSpawner = (sink: SpawnerSink, output = STUB_SEALED_YAML) =>
  stubSpawner({
    respond: () => ({ stdout: output }),
    sink: (cmd) =>
      stdinAsString(cmd).pipe(
        Effect.map((stdin) => {
          sink.lastCmd = cmd
          sink.lastStdin = stdin
        })
      )
  })

const dbCreds = Secret.define({
  name: "db-creds",
  namespace: "prod",
  env: { url: "DATABASE_URL", password: "DATABASE_PASSWORD" }
})

const _lastCommand = (sink: SpawnerSink) => {
  const cmd = sink.lastCmd

  return cmd !== undefined
    ? { command: cmd.command, args: plainArgs(cmd) }
    : expect.unreachable("expected a standard command")
}

const ctx = { env: "prod" } as const

describe("SealedSecrets.backend", () => {
  it.effect("pipes a plaintext Secret to kubeseal and returns the SealedSecret", () =>
    Effect.gen(function*() {
      const sink: SpawnerSink = {}

      const bound = Secret.bind({
        secret: dbCreds,
        backend: SealedSecrets.backend({ scope: "strict", certPath: "/tmp/cert.pem" }),
        source: SecretSource.literal({ data: { url: "u", password: "p" } })
      })

      const rendered = yield* _asSealedSecret(
        yield* bound.manifest!.render(ctx).pipe(Effect.provide(_makeStubSpawner(sink)))
      )

      expect(rendered.apiVersion).toBe("bitnami.com/v1alpha1")
      expect(rendered.kind).toBe("SealedSecret")
      expect(rendered.metadata.name).toBe("db-creds")
      expect(rendered.spec.encryptedData.url).toContain("AgB7nF9")
      const std = _lastCommand(sink)
      expect(std.command).toBe("kubeseal")
      expect(std.args).toEqual([
        "--cert",
        "/tmp/cert.pem",
        "--scope",
        "strict",
        "--format",
        "yaml"
      ])
      expect(sink.lastStdin).toContain("kind: Secret")
      expect(sink.lastStdin).toContain("url: u")
      expect(sink.lastStdin).toContain("password: p")
    }).pipe(Effect.provide(NodeServices.layer)))

  it.effect("forwards labels, annotations and type to the plain Secret", () =>
    Effect.gen(function*() {
      const sink: SpawnerSink = {}

      const bound = Secret.bind({
        secret: dbCreds,
        labels: { app: "db" },
        annotations: { note: "x" },
        backend: SealedSecrets.backend({ certPath: "/tmp/c.pem", type: "kubernetes.io/dockerconfigjson" }),
        source: SecretSource.literal({ data: { url: "u", password: "p" } })
      })

      yield* bound.manifest!.render(ctx).pipe(Effect.provide(_makeStubSpawner(sink)))
      expect(sink.lastStdin).toContain("app: db")
      expect(sink.lastStdin).toContain("note: x")
      expect(sink.lastStdin).toContain("type: kubernetes.io/dockerconfigjson")
    }).pipe(Effect.provide(NodeServices.layer)))

  it.effect("defaults: scope=strict", () =>
    Effect.gen(function*() {
      const sink: SpawnerSink = {}

      const bound = Secret.bind({
        secret: dbCreds,
        backend: SealedSecrets.backend({ certPath: "/tmp/cert.pem" }),
        source: SecretSource.literal({ data: { url: "u", password: "p" } })
      })

      yield* bound.manifest!.render(ctx).pipe(Effect.provide(_makeStubSpawner(sink)))
      const std = _lastCommand(sink)
      expect(std.args).toContain("strict")
    }).pipe(Effect.provide(NodeServices.layer)))

  it.effect("reads cert from $KUBESEAL_CERT when certPath omitted", () =>
    Effect.gen(function*() {
      const sink: SpawnerSink = {}

      const bound = Secret.bind({
        secret: dbCreds,
        backend: SealedSecrets.backend({ scope: "namespace-wide" }),
        source: SecretSource.literal({ data: { url: "u", password: "p" } })
      })

      yield* bound.manifest!.render(ctx).pipe(
        Effect.provide(
          Layer.mergeAll(
            _makeStubSpawner(sink),
            ConfigProvider.layer(ConfigProvider.fromEnv({ env: { KUBESEAL_CERT: "/from/env.pem" } }))
          )
        )
      )
      const std = _lastCommand(sink)
      expect(std.args.some((a: string) => a === "/from/env.pem")).toBe(true)
    }).pipe(Effect.provide(NodeServices.layer)))

  it.effect("fails with RenderError when no cert is available", () =>
    Effect.gen(function*() {
      const sink: SpawnerSink = {}

      const bound = Secret.bind({
        secret: dbCreds,
        backend: SealedSecrets.backend(),
        source: SecretSource.literal({ data: { url: "u", password: "p" } })
      })

      const exit = yield* Effect.exit(
        bound.manifest!.render(ctx).pipe(
          Effect.provide(
            Layer.mergeAll(
              _makeStubSpawner(sink),
              ConfigProvider.layer(ConfigProvider.fromEnv({ env: {} }))
            )
          )
        )
      )

      expect(Exit.isFailure(exit)).toBe(true)
      const error = Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined
      expect(error).toBeInstanceOf(RenderError)
      expect(error instanceof RenderError ? error.message : "").toBe(
        "SealedSecrets(prod/db-creds): cert missing — pass opts.certPath or set $KUBESEAL_CERT"
      )
      expect(error instanceof RenderError ? error.cause : undefined).toBeInstanceOf(KubesealCertMissing)
    }).pipe(Effect.provide(NodeServices.layer)))

  it.effect("fails at render time (not bind time) when source is omitted", () =>
    Effect.gen(function*() {
      const bound = Secret.bind({
        secret: dbCreds,
        backend: SealedSecrets.backend({ certPath: "/x" })
      })

      const exit = yield* Effect.exit(bound.manifest!.render(ctx))
      expect(Exit.isFailure(exit)).toBe(true)

      if (Exit.isFailure(exit)) {
        expect(Cause.pretty(exit.cause)).toContain("requires a source")
      }
    }).pipe(Effect.provide(NodeServices.layer)))

  it.effect("YAML output of rendered manifest reads like the spec", () =>
    Effect.gen(function*() {
      const sink: SpawnerSink = {}

      const bound = Secret.bind({
        secret: dbCreds,
        backend: SealedSecrets.backend({ scope: "strict", certPath: "/tmp/c.pem" }),
        source: SecretSource.literal({ data: { url: "u", password: "p" } })
      })

      const rendered = yield* bound.manifest!.render(ctx).pipe(
        Effect.provide(_makeStubSpawner(sink))
      )

      const yaml = Yaml.serialize({ value: rendered })
      expect(yaml).toContain("apiVersion: bitnami.com/v1alpha1")
      expect(yaml).toContain("kind: SealedSecret")
      expect(yaml).toContain("encryptedData:")
    }).pipe(Effect.provide(NodeServices.layer)))

  it.effect("RenderError if kubeseal stdout isn't valid YAML", () =>
    Effect.gen(function*() {
      const sink: SpawnerSink = {}
      const garbage = "key: [1,2"

      const bound = Secret.bind({
        secret: dbCreds,
        backend: SealedSecrets.backend({ scope: "strict", certPath: "/tmp/c.pem" }),
        source: SecretSource.literal({ data: { url: "u", password: "p" } })
      })

      const exit = yield* Effect.exit(
        bound.manifest!.render(ctx).pipe(Effect.provide(_makeStubSpawner(sink, garbage)))
      )

      expect(Exit.isFailure(exit)).toBe(true)

      if (Exit.isFailure(exit)) {
        const text = Cause.pretty(exit.cause)
        expect(text).toContain("not valid YAML")
        expect(text).toContain("kubeseal failed")
        const error = Cause.squash(exit.cause)
        expect(error instanceof RenderError ? error.cause : undefined).toBeInstanceOf(KubesealParseError)
      }
    }).pipe(Effect.provide(NodeServices.layer)))

  it.effect("labelled RenderError if kubeseal stdout doesn't match SealedSecret schema", () =>
    Effect.gen(function*() {
      const sink: SpawnerSink = {}

      const malformed =
        `apiVersion: bitnami.com/v1alpha1\nkind: NotASealedSecret\nmetadata:\n  name: x\n  namespace: y\nspec:\n  encryptedData:\n    k: v\n`

      const bound = Secret.bind({
        secret: dbCreds,
        backend: SealedSecrets.backend({ scope: "strict", certPath: "/tmp/c.pem" }),
        source: SecretSource.literal({ data: { url: "u", password: "p" } })
      })

      const exit = yield* Effect.exit(
        bound.manifest!.render(ctx).pipe(Effect.provide(_makeStubSpawner(sink, malformed)))
      )

      expect(Exit.isFailure(exit)).toBe(true)

      if (Exit.isFailure(exit)) {
        const text = Cause.pretty(exit.cause)
        expect(text).toContain("RenderError")
        expect(text).toContain("kubeseal output did not match SealedSecret")
      }
    }).pipe(Effect.provide(NodeServices.layer)))
})

describe("_kubesealArgs properties", () => {
  const scope = fc.constantFrom("strict", "namespace-wide", "cluster-wide" as const)

  plainIt("always passes cert, scope and yaml format as flag/value pairs", () => {
    fc.assert(fc.property(fc.string({ minLength: 1 }), scope, (certPath, scope) => {
      const args = _kubesealArgs({ certPath, scope })
      expect(args[args.indexOf("--cert") + 1]).toBe(certPath)
      expect(args[args.indexOf("--scope") + 1]).toBe(scope)
      expect(args[args.indexOf("--format") + 1]).toBe("yaml")
      expect(args).toHaveLength(6)
    }))
  })
})

describe("SealedSecrets.backend timeout option", () => {
  it.effect("fails with ProcessTimeout when kubeseal hangs past the configured timeout", () =>
    Effect.gen(function*() {
      const bound = Secret.bind({
        secret: dbCreds,
        backend: SealedSecrets.backend({ certPath: "/tmp/cert.pem", timeout: "5 seconds" }),
        source: SecretSource.literal({ data: { url: "u", password: "p" } })
      })

      const fiber = yield* Effect.forkChild(
        Effect.exit(bound.manifest!.render(ctx).pipe(Effect.provide(stubSpawner({ respond: () => ({ hang: true }) }))))
      )

      yield* TestClock.adjust("6 seconds")
      const exit = yield* Fiber.join(fiber)

      expect(Exit.isFailure(exit)).toBe(true)
      expect(Exit.isFailure(exit) ? Cause.pretty(exit.cause) : "").toContain("timed out after 5s")
    }).pipe(Effect.provide(NodeServices.layer)))
})
