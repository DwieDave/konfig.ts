import { NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { RenderError } from "@konfig.ts/core"
import { plainArgs, stdinAsString, stubSpawner } from "@konfig.ts/core/testing"
import { type SecretSource, SecretSourceError } from "@konfig.ts/env"
import { NativeSecret, Secret } from "@konfig.ts/k8s"
import { Cause, Effect, Exit, Layer, Redacted, Schema } from "effect"
import type { StandardCommand } from "effect/process/ChildProcess"
import type { ChildProcessSpawner } from "effect/process/ChildProcessSpawner"
import * as fc from "fast-check"
import { describe, expect } from "vitest"
import { Sops } from "./backend"
import { SopsInvocationError } from "./sops"

interface RecordedCall {
  readonly cmd: string
  readonly args: ReadonlyArray<string>
  readonly stdin: string
}

const _recording = (input: {
  readonly calls: RecordedCall[]
  readonly respond: (cmd: StandardCommand) => { readonly stdout?: string; readonly exitCode?: number }
}) =>
  stubSpawner({
    respond: input.respond,
    sink: (cmd) =>
      stdinAsString(cmd).pipe(
        Effect.map((stdin) => void input.calls.push({ cmd: cmd.command, args: plainArgs(cmd), stdin }))
      )
  })

const _resolve = <K extends string>(input: {
  readonly source: SecretSource<K, ChildProcessSpawner>
  readonly stdout?: string
  readonly exitCode?: number
  readonly calls?: RecordedCall[]
}) =>
  input.source.resolve.pipe(
    Effect.map((resolved) => Object.fromEntries(input.source.keys.map((key) => [key, Redacted.value(resolved[key])]))),
    Effect.provide(_recording({ calls: input.calls ?? [], respond: () => input })),
    Effect.scoped
  )

const dbCreds = Secret.define({
  name: "db-creds",
  namespace: "prod",
  env: { url: "DATABASE_URL", password: "DATABASE_PASSWORD" }
})

const _AsSecret = Schema.Struct({ kind: Schema.String, stringData: Schema.Record(Schema.String, Schema.String) })

describe("Sops.source", () => {
  it.effect("decrypts the file once and plucks every requested key, composing with another backend", () =>
    Effect.gen(function*() {
      const calls: RecordedCall[] = []

      const bound = Secret.bind({
        secret: dbCreds,
        backend: NativeSecret.backend({ silenceWarning: true }),
        source: Sops.source({ file: "/tmp/db-creds.enc.yaml", keys: ["url", "password"] })
      })

      const rendered = yield* Schema.decodeUnknownEffect(_AsSecret)(
        yield* bound.manifest!.render({ env: "prod" }).pipe(
          Effect.provide(
            _recording({ calls, respond: () => ({ stdout: "url: u-from-sops\npassword: p-from-sops\n" }) })
          )
        )
      )

      expect(rendered.stringData).toEqual({ url: "u-from-sops", password: "p-from-sops" })
      expect(calls).toHaveLength(1)
      expect(calls[0]?.cmd).toBe("sops")
      expect(calls[0]?.args).toEqual(["--decrypt", "/tmp/db-creds.enc.yaml"])
    }).pipe(Effect.provide(NodeServices.layer)))

  it.effect("wraps each value in Redacted", () =>
    Effect.gen(function*() {
      const source = Sops.source({ file: "/f.yaml", keys: ["url"] })

      const resolved = yield* source.resolve.pipe(
        Effect.provide(stubSpawner({ respond: () => ({ stdout: "url: secret-u\n" }) })),
        Effect.scoped
      )

      expect(Redacted.isRedacted(resolved.url)).toBe(true)
      expect(Redacted.value(resolved.url)).toBe("secret-u")
      expect(JSON.stringify(resolved)).not.toContain("secret-u")
    }))

  it.effect("extract resolves keys from a nested plaintext document", () =>
    Effect.gen(function*() {
      const values = yield* _resolve({
        source: Sops.source({
          file: "/f.yaml",
          keys: ["url", "password"],
          extract: (key, parsed) =>
            Schema.is(Schema.Struct({ db: Schema.Record(Schema.String, Schema.String) }))(parsed)
              ? parsed.db[key]
              : undefined
        }),
        stdout: "db:\n  url: nested-u\n  password: nested-p\n"
      })

      expect(values).toEqual({ url: "nested-u", password: "nested-p" })
    }))

  it("the default extract is a flat lookup for any string values", () =>
    fc.assert(
      fc.asyncProperty(fc.stringMatching(/^[a-z][a-z0-9]{0,8}$/), fc.string(), async (key, value) => {
        const stdout = JSON.stringify({ [key]: value })
        const values = await Effect.runPromise(_resolve({ source: Sops.source({ file: "/f", keys: [key] }), stdout }))

        expect(values).toEqual({ [key]: value })
      })
    ))

  it.effect("fails with SecretSourceError naming the key when the extracted value is not a string", () =>
    Effect.gen(function*() {
      const error = yield* Effect.flip(
        _resolve({ source: Sops.source({ file: "/f.yaml", keys: ["url", "port"] }), stdout: "url: u\nport: 5432\n" })
      )

      expect(error).toBeInstanceOf(SecretSourceError)
      expect(error.source).toBe("Sops")
      expect(error.key).toBe("port")
      expect(String(error.cause)).toContain(`extracted value for "port" is not a string`)
    }))

  it.effect("fails with SecretSourceError when a key is missing from the plaintext", () =>
    Effect.gen(function*() {
      const error = yield* Effect.flip(
        _resolve({ source: Sops.source({ file: "/f.yaml", keys: ["url", "password"] }), stdout: "url: u\n" })
      )

      expect(error.key).toBe("password")
    }))

  it.effect("fails with SecretSourceError (key = file) when the plaintext is not valid YAML", () =>
    Effect.gen(function*() {
      const error = yield* Effect.flip(
        _resolve({ source: Sops.source({ file: "/f.yaml", keys: ["url"] }), stdout: "a: [" })
      )

      expect(error).toBeInstanceOf(SecretSourceError)
      expect(error.key).toBe("/f.yaml")
    }))

  it.effect("a sops failure is a SecretSourceError whose cause is SopsInvocationError(op: decrypt)", () =>
    Effect.gen(function*() {
      const error = yield* Effect.flip(
        _resolve({ source: Sops.source({ file: "/f.yaml", keys: ["url"] }), exitCode: 2 })
      )

      expect(error.key).toBe("/f.yaml")
      expect(error.cause).toBeInstanceOf(SopsInvocationError)
      expect(error.cause instanceof SopsInvocationError ? error.cause.op : undefined).toBe("decrypt")
    }))

  it.effect("surfaces through a backend as RenderError → SecretSourceError → SopsInvocationError", () =>
    Effect.gen(function*() {
      const bound = Secret.bind({
        secret: dbCreds,
        backend: NativeSecret.backend({ silenceWarning: true }),
        source: Sops.source({ file: "/x.enc.yaml", keys: ["url", "password"] })
      })

      const exit = yield* Effect.exit(
        bound.manifest!.render({ env: "prod" }).pipe(
          Effect.provide(Layer.merge(NodeServices.layer, stubSpawner({ respond: () => ({ exitCode: 1 }) })))
        )
      )

      const error = Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined
      expect(error).toBeInstanceOf(RenderError)
      const sourceError = error instanceof RenderError ? error.cause : undefined
      expect(sourceError).toBeInstanceOf(SecretSourceError)
      expect(sourceError instanceof SecretSourceError ? sourceError.cause : undefined).toBeInstanceOf(
        SopsInvocationError
      )
    }))
})
