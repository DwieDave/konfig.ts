import { it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { describe, expect, expectTypeOf } from "vitest"
import { brand } from "./_cast"
import type { ConfigMapRef, Need, PvcRef, PvcRefName, SecretRef, ServiceAccountRef } from "./deps"
import { Application, ConfigMap, Namespace, Pvc, Secret, ServiceAccount } from "./deps"

type SecretReq<N extends string> = Need<"Secret", N>

type ConfigMapReq<N extends string> = Need<"ConfigMap", N>

type NamespaceReq<N extends string> = Need<"Namespace", N>

type ServiceAccountReq<N extends string> = Need<"ServiceAccount", N>

type PvcReq<N extends string> = Need<"Pvc", N>

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

  it.effect("ConfigMap, Namespace, ServiceAccount, Pvc, Application all behave the same", () => {
    const prog = Effect.gen(function*() {
      const cm = yield* ConfigMap("settings")
      const ns = yield* Namespace("prod")
      const sa = yield* ServiceAccount("worker")
      const pvc = yield* Pvc("data")
      const app = yield* Application("api")

      return { cm, ns, sa, pvc, app }
    })

    expectTypeOf(prog).toMatchTypeOf<
      Effect.Effect<
        {
          readonly cm: ConfigMapRef<"settings">
          readonly ns: "prod"
          readonly sa: ServiceAccountRef<"worker">
          readonly pvc: PvcRef<"data">
          readonly app: "api"
        },
        never,
        | ConfigMapReq<"settings">
        | NamespaceReq<"prod">
        | ServiceAccountReq<"worker">
        | PvcReq<"data">
        | ApplicationReq<"api">
      >
    >()

    return prog.pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(ConfigMap("settings"))(brand<ConfigMapRef<"settings">>("settings")),
          Layer.succeed(Namespace("prod"))("prod"),
          Layer.succeed(ServiceAccount("worker"))(brand<ServiceAccountRef<"worker">>("worker")),
          Layer.succeed(Pvc("data"))(brand<PvcRef<"data">>("data")),
          Layer.succeed(Application("api"))("api")
        )
      ),
      Effect.map((result) => {
        expect(result).toEqual({ cm: "settings", ns: "prod", sa: "worker", pvc: "data", app: "api" })
      })
    )
  })

  it("PvcRefName extracts the claim name and ServiceAccountRef rejects a raw string", () => {
    expectTypeOf<PvcRefName<PvcRef<"data">>>().toEqualTypeOf<"data">()
    expectTypeOf<ServiceAccountRef<"a">>().not.toEqualTypeOf<ServiceAccountRef<"b">>()
    // @ts-expect-error a raw string is not a ServiceAccountRef
    const raw: ServiceAccountRef<"a"> = "a"
    expect(raw).toBe("a")
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
