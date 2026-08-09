import { it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { describe, expect, expectTypeOf } from "vitest"
import type { ConfigMapRef, Need, SecretRef, ServiceAccountRef } from "./deps"
import { Application, ConfigMap, Namespace, Secret, ServiceAccount } from "./deps"

type SecretReq<N extends string> = Need<"Secret", N>
type ConfigMapReq<N extends string> = Need<"ConfigMap", N>
type NamespaceReq<N extends string> = Need<"Namespace", N>
type ServiceAccountReq<N extends string> = Need<"ServiceAccount", N>
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
      Effect.provide(
        Layer.succeed(Secret("postgres-credentials"))(
          "postgres-credentials" as SecretRef<"postgres-credentials">
        )
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
          Layer.succeed(Secret("a"))("a" as SecretRef<"a">),
          Layer.succeed(Secret("b"))("b" as SecretRef<"b">)
        )
      ),
      Effect.map((result) => {
        expect(result).toEqual({ a: "a", b: "b" })
      })
    )
  })

  it.effect("ConfigMap, Namespace, ServiceAccount, Application all behave the same", () => {
    const prog = Effect.gen(function*() {
      const cm = yield* ConfigMap("settings")
      const ns = yield* Namespace("prod")
      const sa = yield* ServiceAccount("worker")
      const app = yield* Application("api")
      return { cm, ns, sa, app }
    })
    expectTypeOf(prog).toMatchTypeOf<
      Effect.Effect<
        unknown,
        never,
        | ConfigMapReq<"settings">
        | NamespaceReq<"prod">
        | ServiceAccountReq<"worker">
        | ApplicationReq<"api">
      >
    >()
    return prog.pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(ConfigMap("settings"))("settings" as ConfigMapRef<"settings">),
          Layer.succeed(Namespace("prod"))("prod"),
          Layer.succeed(ServiceAccount("worker"))("worker" as ServiceAccountRef<"worker">),
          Layer.succeed(Application("api"))("api")
        )
      ),
      Effect.map((result) => {
        expect(result).toEqual({
          cm: "settings",
          ns: "prod",
          sa: "worker",
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
      Effect.provide(Layer.succeed(Secret("same"))("same" as SecretRef<"same">)),
      Effect.map((result) => {
        expect(result).toEqual({ a: "same", b: "same" })
      })
    )
  })
})
