import { it } from "@effect/vitest"
import { ConfigProvider, Effect, Schema } from "effect"
import * as fc from "fast-check"
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
      Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env: {} })))
    ))

  it.effect("explicit schema overrides default value-back parser", () =>
    Effect.gen(function*() {
      const port = Literal.define({
        envName: "PORT",
        value: 8080,
        schema: Schema.NumberFromString
      })

      const v = yield* port
      expect(v).toBe(9090)
    }).pipe(
      Effect.provide(
        ConfigProvider.layer(ConfigProvider.fromEnv({ env: { PORT: "9090" } }))
      )
    ))

  it.effect("schema reads the variable named by envName", () =>
    Effect.promise(() =>
      fc.assert(
        fc.asyncProperty(fc.stringMatching(/^[A-Z][A-Z0-9_]{0,10}$/), fc.integer(), async (envName, n) => {
          const entry = Literal.define({ envName, value: 0, schema: Schema.NumberFromString })

          const read = await Effect.runPromise(
            entry.pipe(Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env: { [envName]: String(n) } }))))
          )

          expect(read).toBe(n)
        })
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
