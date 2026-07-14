import { Effect, Layer } from "effect"
import { describe, expect, expectTypeOf, it } from "vitest"
import type { ConfigMapRef, Need, SecretRef, ServiceAccountRef } from "./deps"
import { Application, ConfigMap, Namespace, Secret, ServiceAccount } from "./deps"

type SecretReq<N extends string> = Need<"Secret", N>
type ConfigMapReq<N extends string> = Need<"ConfigMap", N>
type NamespaceReq<N extends string> = Need<"Namespace", N>
type ServiceAccountReq<N extends string> = Need<"ServiceAccount", N>
type ApplicationReq<N extends string> = Need<"Application", N>

describe("deps — yieldable Key constructors", () => {
  it("Secret(name): yielding lifts SecretReq<N> into R, layer discharges", async () => {
    const prog = Effect.gen(function*() {
      const ref = yield* Secret("postgres-credentials")
      return ref
    })
    expectTypeOf(prog).toMatchTypeOf<
      Effect.Effect<SecretRef<"postgres-credentials">, never, SecretReq<"postgres-credentials">>
    >()
    const result = await Effect.runPromise(
      prog.pipe(
        Effect.provide(
          Layer.succeed(Secret("postgres-credentials"))(
            "postgres-credentials" as SecretRef<"postgres-credentials">
          )
        )
      )
    )
    expect(result).toBe("postgres-credentials")
  })

  it("Two distinct Secret names produce two distinct R slots", async () => {
    const prog = Effect.gen(function*() {
      const a = yield* Secret("a")
      const b = yield* Secret("b")
      return { a, b }
    })
    expectTypeOf(prog).toMatchTypeOf<
      Effect.Effect<unknown, never, SecretReq<"a"> | SecretReq<"b">>
    >()
    const result = await Effect.runPromise(
      prog.pipe(
        Effect.provide(
          Layer.mergeAll(
            Layer.succeed(Secret("a"))("a" as SecretRef<"a">),
            Layer.succeed(Secret("b"))("b" as SecretRef<"b">)
          )
        )
      )
    )
    expect(result).toEqual({ a: "a", b: "b" })
  })

  it("ConfigMap, Namespace, ServiceAccount, Application all behave the same", async () => {
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
    const result = await Effect.runPromise(
      prog.pipe(
        Effect.provide(
          Layer.mergeAll(
            Layer.succeed(ConfigMap("settings"))("settings" as ConfigMapRef<"settings">),
            Layer.succeed(Namespace("prod"))("prod"),
            Layer.succeed(ServiceAccount("worker"))("worker" as ServiceAccountRef<"worker">),
            Layer.succeed(Application("api"))("api")
          )
        )
      )
    )
    expect(result).toEqual({
      cm: "settings",
      ns: "prod",
      sa: "worker",
      app: "api"
    })
  })

  it("Two calls with the same name resolve to the same provider value", async () => {
    const prog = Effect.gen(function*() {
      const a = yield* Secret("same")
      const b = yield* Secret("same")
      return { a, b }
    })
    const result = await Effect.runPromise(
      prog.pipe(Effect.provide(Layer.succeed(Secret("same"))("same" as SecretRef<"same">)))
    )
    expect(result).toEqual({ a: "same", b: "same" })
  })
})
