import { it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { describe, expect, expectTypeOf } from "vitest"
import { brand } from "./_cast"
import type { Need, SecretRef } from "./deps"
import { Application, Namespace, Secret } from "./deps"

type SecretReq<N extends string> = Need<"Secret", N>

type NamespaceReq<N extends string> = Need<"Namespace", N>

type ApplicationReq<N extends string> = Need<"Application", N>

describe("deps — yieldable Key constructors", () => {
  it.effect("Secret(name): yielding lifts SecretReq<N> into R, layer discharges", () => {
    const prog = Effect.gen(function*() {
      const ref = yield* Secret("postgres-credentials")

      return ref
    })

    expectTypeOf(prog).toMatchTypeOf<
      Effect.Effect<SecretRef<"postgres-credentials">, never, SecretReq<"postgres-credentials">>
    >()

    return prog.pipe(
      Effect.provideService(
        Secret("postgres-credentials"),
        brand<SecretRef<"postgres-credentials">>("postgres-credentials")
      ),
      Effect.map((result) => {
        expect(result).toBe("postgres-credentials")
      })
    )
  })

  it.effect("Two distinct Secret names produce two distinct R slots", () => {
    const prog = Effect.gen(function*() {
      const a = yield* Secret("a")
      const b = yield* Secret("b")

      return { a, b }
    })

    expectTypeOf(prog).toMatchTypeOf<
      Effect.Effect<unknown, never, SecretReq<"a"> | SecretReq<"b">>
    >()

    return prog.pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(Secret("a"))(brand<SecretRef<"a">>("a")),
          Layer.succeed(Secret("b"))(brand<SecretRef<"b">>("b"))
        )
      ),
      Effect.map((result) => {
        expect(result).toEqual({ a: "a", b: "b" })
      })
    )
  })

  it.effect("Namespace and Application behave like Secret", () => {
    const prog = Effect.gen(function*() {
      const ns = yield* Namespace("prod")
      const app = yield* Application("api")

      return { ns, app }
    })

    expectTypeOf(prog).toMatchTypeOf<
      Effect.Effect<
        unknown,
        never,
        | NamespaceReq<"prod">
        | ApplicationReq<"api">
      >
    >()

    return prog.pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(Namespace("prod"))("prod"),
          Layer.succeed(Application("api"))("api")
        )
      ),
      Effect.map((result) => {
        expect(result).toEqual({
          ns: "prod",
          app: "api"
        })
      })
    )
  })

  it.effect("Two calls with the same name resolve to the same provider value", () => {
    const prog = Effect.gen(function*() {
      const a = yield* Secret("same")
      const b = yield* Secret("same")

      return { a, b }
    })

    return prog.pipe(
      Effect.provideService(Secret("same"), brand<SecretRef<"same">>("same")),
      Effect.map((result) => {
        expect(result).toEqual({ a: "same", b: "same" })
      })
    )
  })
})
