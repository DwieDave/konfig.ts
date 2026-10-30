import { NodeServices } from "@effect/platform-node"
import { describe, expect, it, layer } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { brand } from "./_cast"
import { type Bundle, define } from "./Bundle"
import { composeLayers, makeResidualEntrypoint, moduleLayer, sealModules } from "./Compose"
import type { ComposeHandle, DuplicateProvides } from "./Compose"
import { provideSecret, Secret } from "./deps"
import type { Need, Provide, SecretRef } from "./deps"
import { RenderError } from "./RenderError"

// --- type-level: DuplicateProvides -----------------------------------------
type _Expect<T extends true> = T

type _Eq<A, B> = [A] extends [B] ? [B] extends [A] ? true : false : false

type _AppHandle<N extends string, Ns extends string> = ComposeHandle<
  Provide<"App", N> | Provide<"Application", N> | Provide<"Namespace", Ns>,
  never
>

type _Api = _AppHandle<"api", "app">

type _ApiClone = _AppHandle<"api", "app">

type _Web = _AppHandle<"web", "app">

type _SecretProvider<N extends string> = ComposeHandle<Provide<"Secret", N>, never>

// two apps with the same name → duplicate surfaces as the App Need
type _dup = _Expect<_Eq<DuplicateProvides<[_Api, _ApiClone]>, Need<"App", "api">>>

// distinct names sharing a namespace → clean (Namespace is not a unique kind)
type _clean = _Expect<_Eq<DuplicateProvides<[_Api, _Web]>, never>>

// the same handle listed twice → duplicate
type _twice = _Expect<_Eq<DuplicateProvides<[_Web, _Web]>, Need<"App", "web">>>

// two providers of the same Secret → duplicate
type _dupSecret = _Expect<
  _Eq<
    DuplicateProvides<[_SecretProvider<"ghcr-pull">, _SecretProvider<"ghcr-pull">]>,
    Need<"Secret", "ghcr-pull">
  >
>

// "Application" is excluded — the paired App Need alone reports the collision
type _noDouble = _Expect<
  _Eq<Extract<DuplicateProvides<[_Api, _ApiClone]>, Need<"Application", string>>, never>
>

describe("composeLayers", () => {
  it.effect("supplies a sibling's Out as a later module's In (left-fold topo-sort)", () =>
    Effect.gen(function*() {
      const providerLayer = Layer.succeed(Secret("shared"))(
        brand<SecretRef<"shared">>("shared")
      )

      const consumerLayer = Layer.effectDiscard(
        Effect.gen(function*() {
          const ref = yield* Secret("shared")
          expect(ref).toBe("shared")
        })
      )

      const wired = composeLayers({ modules: [{ layer: providerLayer }, { layer: consumerLayer }] })
      yield* Layer.build(wired).pipe(Effect.scoped, Effect.asVoid)
    }))

  it.effect("collapses to an empty layer when given no modules", () =>
    Effect.gen(function*() {
      const wired = composeLayers({ modules: [] })
      yield* Layer.build(wired).pipe(Effect.scoped, Effect.asVoid)
    }))
})

describe("makeResidualEntrypoint", () => {
  it.effect("returns its input Effect unchanged at runtime", () =>
    Effect.gen(function*() {
      const entrypoint = makeResidualEntrypoint("Test.fromModules")
      const program = Effect.succeed("ok")
      const result = yield* entrypoint(program)
      expect(result).toBe("ok")
    }))
})

layer(NodeServices.layer)("sealModules", (it) => {
  const a = define({ name: "a", build: () => [] })
  const b = define({ name: "b", build: () => [] })

  it.effect("passes module values to build in order", () =>
    Effect.gen(function*() {
      const result = yield* sealModules<Bundle, Need<"App", "a" | "b">, ReadonlyArray<string>>({
        modules: [a, b],
        build: (values) => values.map((v) => v.name)
      })

      expect(result).toEqual(["a", "b"])
    }))

  it.effect("wires provides into module resolution", () =>
    Effect.gen(function*() {
      const consumer = define({
        name: "c",
        build: Effect.map(Secret("p"), () => [])
      })

      const result = yield* sealModules({
        modules: [consumer],
        provides: provideSecret("p"),
        build: (values) => values.length
      })

      expect(result).toBe(1)
    }))

  it.effect("surfaces a failing module error", () =>
    Effect.gen(function*() {
      const failing = define({ name: "f", build: Effect.fail(new RenderError({ message: "boom" })) })
      const exit = yield* Effect.exit(sealModules({ modules: [failing], build: () => 1 }))
      expect(exit._tag).toBe("Failure")
    }))
})

describe("moduleLayer", () => {
  const built = (provides?: Layer.Layer<never>) =>
    Effect.gen(function*() {
      const tag = Secret("m")

      const layer = moduleLayer({
        tag,
        build: Effect.succeed([1, 2]),
        toValue: (items) => brand<SecretRef<"m">>(`n${items.length}`),
        owns: Layer.empty,
        provides
      })

      return yield* tag.pipe(Effect.provide(layer))
    })

  it.effect("builds without provides", () => built().pipe(Effect.map((v) => expect(v).toBe("n2"))))

  it.effect("builds with provides", () => built(Layer.empty).pipe(Effect.map((v) => expect(v).toBe("n2"))))
})
