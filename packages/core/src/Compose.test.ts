import { Effect, Layer } from "effect"
import { describe, expect, it } from "vitest"
import { brand } from "./_cast"
import { composeLayers, makeResidualEntrypoint } from "./Compose"
import type { ComposeHandle, DuplicateProvides } from "./Compose"
import { Secret } from "./deps"
import type { Need, Provide, SecretRef } from "./deps"

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
  it("supplies a sibling's Out as a later module's In (left-fold topo-sort)", async () => {
    const providerLayer = Layer.succeed(Secret("shared"))(
      brand<SecretRef<"shared">>("shared")
    )
    const consumerLayer = Layer.effectDiscard(
      Effect.gen(function*() {
        const ref = yield* Secret("shared")
        expect(ref).toBe("shared")
      })
    )
    const wired = composeLayers([{ layer: providerLayer }, { layer: consumerLayer }])
    await Effect.runPromise(
      Layer.build(wired).pipe(Effect.scoped, Effect.asVoid)
    )
  })

  it("collapses to an empty layer when given no modules", async () => {
    const wired = composeLayers([])
    await Effect.runPromise(
      Layer.build(wired).pipe(Effect.scoped, Effect.asVoid)
    )
  })
})

describe("makeResidualEntrypoint", () => {
  it("returns its input Effect unchanged at runtime", async () => {
    const entrypoint = makeResidualEntrypoint("Test.fromModules")
    const program = Effect.succeed("ok")
    const result = await Effect.runPromise(entrypoint(program))
    expect(result).toBe("ok")
  })
})
