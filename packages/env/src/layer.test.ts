import { it } from "@effect/vitest"
import { Config, ConfigProvider, Context, Effect, Layer, Redacted } from "effect"
import { describe, expect, expectTypeOf } from "vitest"
import { Environment } from "./environment"
import type { EnvironmentShape } from "./index"
import { environmentLayer } from "./layer"
import { Literal } from "./literal"
import { Secret } from "./secret"

const dbCreds = Secret.define({
  name: "db-creds",
  namespace: "prod",
  env: { url: "DATABASE_URL", password: "DATABASE_PASSWORD" }
})

const port = Literal.define({ envName: "PORT", value: 8080 })

const apiEnv = Environment.define({ db: dbCreds, port })

type ApiEnvValues = EnvironmentShape<typeof apiEnv.members>

class ApiEnv extends Context.Service<ApiEnv, ApiEnvValues>()("ApiEnv") {}

const fakeEnv = ConfigProvider.layer(
  ConfigProvider.fromEnv({
    env: {
      DATABASE_URL: "postgres://localhost/api",
      DATABASE_PASSWORD: "hunter2"
    }
  })
)

const apiLayer = environmentLayer({ tag: ApiEnv, env: apiEnv })

describe("environmentLayer", () => {
  it.effect("keeps ConfigError in the layer error channel", () =>
    Effect.gen(function*() {
      const failure = yield* Layer.build(
        Layer.provide(apiLayer, ConfigProvider.layer(ConfigProvider.fromEnv({ env: {} })))
      ).pipe(Effect.scoped, Effect.flip)

      expect(failure).toBeInstanceOf(Config.ConfigError)
    }))

  it("types the error channel as ConfigError", () => {
    expectTypeOf(apiLayer).toEqualTypeOf<Layer.Layer<ApiEnv, Config.ConfigError>>()
  })

  it.effect("provides the decoded environment as a Context service", () =>
    Effect.gen(function*() {
      const env = yield* ApiEnv
      expect(env.port).toBe(8080)
      expect(Redacted.value(env.db.url)).toBe("postgres://localhost/api")
      expect(Redacted.value(env.db.password)).toBe("hunter2")
    }).pipe(Effect.provide(Layer.provide(apiLayer, fakeEnv))))

  it.effect("yields are typed end-to-end", () =>
    Effect.gen(function*() {
      const env = yield* ApiEnv
      const portPlus: number = env.port + 1
      expect(portPlus).toBe(8081)
    }).pipe(Effect.provide(Layer.provide(apiLayer, fakeEnv))))
})

describe("the 0.4.0 EnvironmentShape alias", () => {
  it("maps each member to its decoded value", () => {
    expectTypeOf<ApiEnvValues>().toEqualTypeOf<{
      readonly db: { readonly url: Redacted.Redacted<string>; readonly password: Redacted.Redacted<string> }
      readonly port: number
    }>()
  })
})
