import { describe, expect, expectTypeOf, it } from "vitest"
import * as Env from "./index"
import type {
  DefineDownwardInput,
  DefineLiteralInput,
  DefineSecretInput,
  EntryKind,
  EntryMarker,
  EnvClaim,
  EnvironmentShape,
  FromCommandInput,
  FromCommandSpec,
  FromConfigInput,
  HasEnvClaims,
  LiteralInput,
  MemberValue
} from "./index"

describe("env barrel", () => {
  it.each(["environmentLayer", "typedKeys", "collectByKey", "EnvNameCollision"])(
    "exports the 0.4.0 runtime export %s",
    (name) => {
      expect(name in Env).toBe(true)
    }
  )

  it("typedKeys returns the own string keys", () => {
    const keys = Env.typedKeys({ a: 1, b: 2 })
    expectTypeOf(keys).toEqualTypeOf<Array<"a" | "b">>()
    expect(keys).toEqual(["a", "b"])
  })

  it("collectByKey builds a record with exactly the given keys", () => {
    const out = Env.collectByKey({ keys: ["x", "y"] as const, build: (key) => key.toUpperCase() })
    expectTypeOf(out).toEqualTypeOf<{ readonly x: string; readonly y: string }>()
    expect(out).toEqual({ x: "X", y: "Y" })
  })

  it("EnvNameCollision is the class Environment.define throws", () => {
    const a = Env.Literal.define({ envName: "PORT", value: 1 })
    const b = Env.Literal.define({ envName: "PORT", value: 2 })
    const inner = Env.Environment.define({ b })
    expect(() => Env.Environment.define({ a, inner })).toThrow(Env.EnvNameCollision)
  })

  it("exports the 0.4.0 public types", () => {
    expectTypeOf<EntryKind>().toEqualTypeOf<"Secret" | "Literal" | "Downward" | "Environment">()
    expectTypeOf<EntryMarker<"Literal">>().toEqualTypeOf<{ readonly _kind: "Literal" }>()
    expectTypeOf<EnvClaim>().toEqualTypeOf<{ readonly envName: string; readonly label: string }>()
    expectTypeOf<HasEnvClaims>().toEqualTypeOf<{ readonly envClaims: ReadonlyArray<EnvClaim> }>()
    expectTypeOf<MemberValue<Env.LiteralEntry<"PORT", number>>>().toEqualTypeOf<number>()
    expectTypeOf<EnvironmentShape<{ readonly port: Env.LiteralEntry<"PORT", number> }>>().toEqualTypeOf<{
      readonly port: number
    }>()
    expectTypeOf<DefineDownwardInput<"POD">>().toEqualTypeOf<{ readonly envName: "POD"; readonly fieldPath: string }>()
    expectTypeOf<DefineLiteralInput<"PORT", number>>().toHaveProperty("envName")
    expectTypeOf<DefineSecretInput<"db", { readonly url: "DATABASE_URL" }>>().toHaveProperty("namespace")
    expectTypeOf<FromConfigInput<"k">>().toHaveProperty("keys")
    expectTypeOf<LiteralInput<{ readonly k: string }>>().toHaveProperty("data")
    expectTypeOf<FromCommandSpec>().toHaveProperty("cmd")
    expectTypeOf<FromCommandInput<"k">>().toHaveProperty("run")
  })
})
