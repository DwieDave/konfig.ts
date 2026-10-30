import { it } from "@effect/vitest"
import { Config, ConfigProvider, Context, Effect, Layer, Redacted } from "effect"
import { describe, expect } from "vitest"
import { Environment } from "./environment"
import { environmentLayer, type EnvironmentValues } from "./layer"
import { Literal } from "./literal"
import { Secret } from "./secret"

const dbCreds = Secret.define({
  name: "db-creds",
  namespace: "prod",
  env: { url: "DATABASE_URL", password: "DATABASE_PASSWORD" }
})

const port = Literal.define({ envName: "PORT", value: 8080 })

const apiEnv = Environment.define({ db: dbCreds, port })

type ApiEnvValues = EnvironmentValues<typeof apiEnv.members>

class ApiEnv extends Context.Service<ApiEnv, ApiEnvValues>()("ApiEnv") {}

const fakeEnv = ConfigProvider.layer(
  ConfigProvider.fromEnv({
    env: {
      DATABASE_URL: "postgres://localhost/api",
      DATABASE_PASSWORD: "hunter2"
    }
  })
)

describe("environmentLayer", () => {
  it.effect("keeps ConfigError in the layer error channel", () =>
    Effect.gen(function*() {
      const exit = yield* Layer.build(
        Layer.provide(
          environmentLayer({ tag: ApiEnv, env: apiEnv }),
          ConfigProvider.layer(ConfigProvider.fromEnv({ env: {} }))
        )
      ).pipe(Effect.scoped, Effect.flip)

      expect(exit).toBeInstanceOf(Config.ConfigError)
    }))

  it("types the error channel as ConfigError", () => {
    const layer: Layer.Layer<ApiEnv, Config.ConfigError> = environmentLayer({ tag: ApiEnv, env: apiEnv })
    expect(layer).toBeDefined()
  })

  it.effect("provides the yielded bundle as a Context service", () =>
    Effect.gen(function*() {
      const env = yield* ApiEnv
      expect(env.port).toBe(8080)
      expect(Redacted.value(env.db.url)).toBe("postgres://localhost/api")
      expect(Redacted.value(env.db.password)).toBe("hunter2")
    }).pipe(Effect.provide(Layer.provide(environmentLayer({ tag: ApiEnv, env: apiEnv }), fakeEnv))))

  it.effect("yields are typed end-to-end", () =>
    Effect.gen(function*() {
      const env = yield* ApiEnv
      const portPlus: number = env.port + 1
      expect(portPlus).toBe(8081)
    }).pipe(Effect.provide(Layer.provide(environmentLayer({ tag: ApiEnv, env: apiEnv }), fakeEnv))))
})

type _ExpectedValues = {
  db: { url: Redacted.Redacted<string>; password: Redacted.Redacted<string> }
  port: number
}

type _SameValues = ApiEnvValues extends _ExpectedValues ? (_ExpectedValues extends ApiEnvValues ? true : false) : false

const _assertValuesMatch: _SameValues = true

void _assertValuesMatch
