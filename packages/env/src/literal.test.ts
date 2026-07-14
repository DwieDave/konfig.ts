import { it } from "@effect/vitest"
import { Config, ConfigProvider, Effect } from "effect"
import { describe, expect } from "vitest"
import { Literal } from "./literal"

describe("Literal", () => {
  it("string literal — yields back the same value", () => {
    const nodeEnv = Literal.define({ envName: "NODE_ENV", value: "production" })
    expect(nodeEnv._kind).toBe("Literal")
    expect(nodeEnv.envName).toBe("NODE_ENV")
    expect(nodeEnv.value).toBe("production")
    expect(nodeEnv.serialized).toBe("production")
    expect(nodeEnv.envClaims).toEqual([
      { envName: "NODE_ENV", label: "Literal(NODE_ENV)" }
    ])
  })

  it("number literal — serializes via String(value)", () => {
    const port = Literal.define({ envName: "PORT", value: 8080 })
    expect(port.value).toBe(8080)
    expect(port.serialized).toBe("8080")
  })

  it.effect("yields the literal value without consulting env", () =>
    Effect.gen(function*() {
      const port = Literal.define({ envName: "PORT", value: 8080 })
      const v = yield* port
      expect(v).toBe(8080)
    }).pipe(
      // Provider is empty — literal does not read it.
      Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env: {} })))
    ))

  it.effect("explicit schema overrides default value-back parser", () =>
    Effect.gen(function*() {
      const port = Literal.define({
        envName: "PORT",
        value: 8080,
        schema: Config.port("PORT")
      })
      const v = yield* port
      expect(v).toBe(9090)
    }).pipe(
      Effect.provide(
        ConfigProvider.layer(ConfigProvider.fromEnv({ env: { PORT: "9090" } }))
      )
    ))

  it("custom serialize is invoked", () => {
    const flag = Literal.define({
      envName: "FEATURE",
      value: { ratio: 0.25 },
      serialize: (v) => `${v.ratio * 100}%`
    })
    expect(flag.serialized).toBe("25%")
  })

  it("preserves literal types of envName (compile-time)", () => {
    const port = Literal.define({ envName: "PORT", value: 8080 })
    const env: "PORT" = port.envName
    expect(env).toBe("PORT")
  })
})
