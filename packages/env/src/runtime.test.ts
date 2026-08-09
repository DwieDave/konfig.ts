import { it } from "@effect/vitest"
import { ConfigProvider, Effect, Redacted } from "effect"
import { describe, expect } from "vitest"
import { Environment } from "./environment"
import { Literal } from "./literal"
import { runtime } from "./runtime"
import { Secret } from "./secret"

describe("Environment.runtime (decoder)", () => {
  it.effect("decodes a single bundle from a ConfigProvider in one effect", () =>
    Effect.gen(function*() {
      const env = Environment.define({
        db: Secret.define({
          name: "db-creds",
          namespace: "app",
          env: { url: "DATABASE_URL", password: "DATABASE_PASSWORD" }
        }),
        port: Literal.define({ envName: "PORT", value: 8080 })
      })

      const decoded = yield* runtime(env).pipe(
        Effect.provide(
          ConfigProvider.layer(
            ConfigProvider.fromEnv({
              env: {
                DATABASE_URL: "postgres://localhost/api",
                DATABASE_PASSWORD: "hunter2",
                PORT: "8080"
              }
            })
          )
        )
      )
      expect(Redacted.value(decoded.db.url)).toBe("postgres://localhost/api")
      expect(Redacted.value(decoded.db.password)).toBe("hunter2")
      expect(decoded.port).toBe(8080)
    }))
})
