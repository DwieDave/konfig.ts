import { it } from "@effect/vitest"
import { type FakeProc, stubSpawner } from "@konfig.ts/core/testing"
import { ConfigProvider, Effect, Exit, Redacted, Schema } from "effect"
import { describe, expect } from "vitest"
import { SecretSource, SecretSourceError } from "./source"

const _fakeSpawner = (proc: FakeProc) => stubSpawner({ respond: () => proc })

describe("SecretSource.fromConfig", () => {
  it.effect("resolves each key via Config.Redacted", () =>
    Effect.gen(function*() {
      const src = SecretSource.fromConfig({ keys: ["url", "password"] as const })
      const v = yield* src.resolve
      expect(Redacted.value(v.url)).toBe("postgres://localhost/api")
      expect(Redacted.value(v.password)).toBe("hunter2")
    }).pipe(
      Effect.provide(
        ConfigProvider.layer(
          ConfigProvider.fromUnknown({
            url: "postgres://localhost/api",
            password: "hunter2"
          })
        )
      )
    ))

  it.effect("envName mapping is applied", () =>
    Effect.gen(function*() {
      const src = SecretSource.fromConfig({
        keys: ["url", "password"] as const,
        envName: (k) => `DB_${k.toUpperCase()}`
      })

      const v = yield* src.resolve
      expect(Redacted.value(v.url)).toBe("u")
      expect(Redacted.value(v.password)).toBe("p")
    }).pipe(
      Effect.provide(
        ConfigProvider.layer(
          ConfigProvider.fromUnknown({ DB_URL: "u", DB_PASSWORD: "p" })
        )
      )
    ))

  it.effect("missing key surfaces as SecretSourceError", () =>
    Effect.gen(function*() {
      const src = SecretSource.fromConfig({ keys: ["url"] as const })
      const r = yield* Effect.exit(src.resolve)
      expect(Exit.isFailure(r)).toBe(true)

      if (Exit.isFailure(r)) {
        const err = r.cause.toJSON()
        const json = yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(err)
        expect(json).toContain("SecretSourceError")
      }
    }).pipe(Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({})))))

  it("exposes the key list verbatim", () => {
    const src = SecretSource.fromConfig({ keys: ["a", "b", "c"] as const })
    expect(src.keys).toEqual(["a", "b", "c"])
  })
})

describe("SecretSource.literal", () => {
  it.effect("yields Redacted values from inline data", () =>
    Effect.gen(function*() {
      const src = SecretSource.literal({ data: { url: "u", password: "p" } })
      const v = yield* src.resolve
      expect(Redacted.value(v.url)).toBe("u")
      expect(Redacted.value(v.password)).toBe("p")
    }))

  it("derives keys from the data record", () => {
    const src = SecretSource.literal({ data: { url: "u", password: "p" } })
    expect([...src.keys].sort()).toEqual(["password", "url"])
  })

  it("preserves literal key types (compile-time)", () => {
    const src = SecretSource.literal({ data: { url: "u" } })
    const keys: ReadonlyArray<"url"> = src.keys
    expect(keys).toEqual(["url"])
  })
})

describe("SecretSource.fromCommand", () => {
  it.effect("returns the redacted, newline-trimmed stdout on success", () =>
    Effect.gen(function*() {
      const src = SecretSource.fromCommand({
        keys: ["token"] as const,
        run: () => ({ cmd: "get-secret", args: [] })
      })

      const v = yield* src.resolve.pipe(Effect.provide(_fakeSpawner({ stdout: "s3cr3t\n\n" })))
      expect(Redacted.value(v.token)).toBe("s3cr3t")
    }))

  it.effect("trims leading and trailing whitespace, not just trailing newlines", () =>
    Effect.gen(function*() {
      const src = SecretSource.fromCommand({
        keys: ["token"] as const,
        run: () => ({ cmd: "get-secret", args: [] })
      })

      const v = yield* src.resolve.pipe(
        Effect.provide(_fakeSpawner({ stdout: "  s3cr3t  \n" }))
      )

      expect(Redacted.value(v.token)).toBe("s3cr3t")
    }))

  it.effect("a non-zero exit surfaces as SecretSourceError (never a redacted empty)", () =>
    Effect.gen(function*() {
      const src = SecretSource.fromCommand({
        keys: ["token"] as const,
        run: () => ({ cmd: "get-secret", args: [] })
      })

      const r = yield* Effect.exit(
        src.resolve.pipe(Effect.provide(_fakeSpawner({ stdout: "", stderr: "denied", exitCode: 1 })))
      )

      expect(Exit.isFailure(r)).toBe(true)

      if (Exit.isFailure(r)) {
        const json = yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(r.cause)
        expect(json).toContain("SecretSourceError")
      }
    }))

  it.effect("empty stdout on a zero exit fails rather than yielding Redacted.make(\"\")", () =>
    Effect.gen(function*() {
      const src = SecretSource.fromCommand({
        keys: ["token"] as const,
        run: () => ({ cmd: "get-secret", args: [] })
      })

      const r = yield* Effect.exit(
        src.resolve.pipe(Effect.provide(_fakeSpawner({ stdout: "   \n", exitCode: 0 })))
      )

      expect(Exit.isFailure(r)).toBe(true)

      if (Exit.isFailure(r)) {
        const json = yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(r.cause)
        expect(json).toContain("SecretSourceError")
      }
    }))

  it.effect("whitespace-only stdout fails via source.ts's own guard, not core's", () =>
    Effect.gen(function*() {
      const src = SecretSource.fromCommand({
        keys: ["token"] as const,
        run: () => ({ cmd: "get-secret", args: [] })
      })

      const r = yield* Effect.exit(
        src.resolve.pipe(Effect.provide(_fakeSpawner({ stdout: "   ", exitCode: 0 })))
      )

      expect(Exit.isFailure(r)).toBe(true)

      if (Exit.isFailure(r)) {
        const json = yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(r.cause)
        expect(json).toContain("secret command produced empty output")
      }
    }))
})

describe("SecretSource error shape", () => {
  it("error carries source name + key + cause", () => {
    const err = new SecretSourceError({
      source: "fromConfig",
      key: "url",
      cause: "missing"
    })

    expect(err._tag).toBe("SecretSourceError")
    expect(err.source).toBe("fromConfig")
    expect(err.key).toBe("url")
    expect(err.cause).toBe("missing")
  })
})
