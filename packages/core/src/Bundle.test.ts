import { NodeServices } from "@effect/platform-node"
import { describe, expect, it, layer } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { define, fromModules, make, makeSet } from "./Bundle"
import * as Dep from "./deps"
import { asLiteralName } from "./Module"

describe("Bundle.make", () => {
  it("constructs a Bundle with the given fields", () => {
    const b = make({
      name: "api",
      namespace: "app",
      manifests: [{ kind: "ConfigMap", metadata: { name: "api-conf" } }]
    })

    expect(b).toEqual({
      name: "api",
      namespace: "app",
      manifests: [{ kind: "ConfigMap", metadata: { name: "api-conf" } }]
    })
  })

  it("omits namespace when not provided", () => {
    const b = make({ name: "cluster-scoped", manifests: [] })
    expect("namespace" in b).toBe(false)
  })
})

describe("Bundle.makeSet", () => {
  it("defaults the set name to bundles", () => {
    const bundles = [make({ name: "a", manifests: [] })]
    expect(makeSet({ bundles })).toEqual({ name: "bundles", bundles })
  })

  it("keeps a given set name", () => {
    expect(makeSet({ name: "platform", bundles: [] }).name).toBe("platform")
  })
})

describe("Bundle.define", () => {
  it.effect("omits namespace on the built Bundle when none is given", () =>
    Effect.gen(function*() {
      const handle = define({ name: "cluster-scoped", build: () => [] })
      const b = yield* handle.pipe(Effect.provide(handle.layer))
      expect(b.namespace).toBeUndefined()
    }))

  it.effect("returns a yieldable handle whose value is the built Bundle", () =>
    Effect.gen(function*() {
      const handle = define({
        name: "api",
        namespace: "app",
        build: () => [{ kind: "ConfigMap", metadata: { name: "api-conf" } }]
      })

      const b = yield* handle.pipe(Effect.provide(handle.layer))
      expect(b.name).toBe("api")
      expect(b.namespace).toBe("app")
      expect(b.manifests).toHaveLength(1)
    }))

  it.effect("supports an Effect-returning build that reads from a provided Layer", () =>
    Effect.gen(function*() {
      const handle = define({
        name: "consumer",
        namespace: "app",
        build: Effect.gen(function*() {
          const ref = yield* Dep.Secret("shared")

          return [{ kind: "ConfigMap", metadata: { name: ref } }]
        })
      })

      const providerLayer = Dep.provideSecret("shared")

      const b = yield* handle.pipe(
        Effect.provide(Layer.provideMerge(handle.layer, providerLayer))
      )

      expect(b.manifests[0]).toEqual({
        kind: "ConfigMap",
        metadata: { name: "shared" }
      })
    }))

  it.effect("supports a cluster-scoped bundle with no namespace", () =>
    Effect.gen(function*() {
      const handle = define({
        name: "crds",
        build: () => [
          { kind: "CustomResourceDefinition", metadata: { name: "foos.example.com" } }
        ]
      })

      const b = yield* handle.pipe(Effect.provide(handle.layer))
      expect(b.namespace).toBeUndefined()
      expect(b.name).toBe("crds")
    }))
})

layer(NodeServices.layer)("Bundle.fromModules", (it) => {
  it.effect("composes bundles in listed order and exposes the merged result", () =>
    Effect.gen(function*() {
      const a = define({
        name: "a",
        namespace: "ns-a",
        build: () => [{ kind: "ConfigMap", metadata: { name: "a" } }]
      })

      const b = define({
        name: "b",
        namespace: "ns-b",
        build: () => [{ kind: "ConfigMap", metadata: { name: "b" } }]
      })

      const result = yield* fromModules({ modules: [a, b] as const })
      expect(result.name).toBe("bundles")
      expect(result.bundles.map((x) => x.name)).toEqual(["a", "b"])
    }))

  it.effect("supplies a sibling's Provide to a later module's Need", () =>
    Effect.gen(function*() {
      const provider = define({
        name: "provider",
        namespace: "infra",
        build: () => [],
        provides: Dep.provideSecret("shared")
      })

      const consumer = define({
        name: "consumer",
        namespace: "app",
        build: Effect.gen(function*() {
          const ref = yield* Dep.Secret("shared")

          return [{ kind: "ConfigMap", metadata: { name: ref } }]
        })
      })

      const result = yield* fromModules({ modules: [provider, consumer] as const })
      const consumerBundle = result.bundles.find((x) => x.name === "consumer")
      expect(consumerBundle?.manifests[0]).toEqual({
        kind: "ConfigMap",
        metadata: { name: "shared" }
      })
    }))

  it.effect("resolves ConfigMap, ServiceAccount and Pvc needs from earlier providers", () =>
    Effect.gen(function*() {
      const provider = define({
        name: "provider",
        namespace: "infra",
        build: () => [],
        provides: Layer.mergeAll(
          Dep.provideConfigMap("settings"),
          Dep.provideServiceAccount("worker"),
          Dep.providePvc("data")
        )
      })

      const consumer = define({
        name: "consumer",
        namespace: "app",
        build: Effect.gen(function*() {
          const cm = yield* Dep.ConfigMap("settings")
          const sa = yield* Dep.ServiceAccount("worker")
          const pvc = yield* Dep.Pvc("data")

          return [{ cm, sa, pvc }]
        })
      })

      const result = yield* fromModules({ modules: [provider, consumer] as const })
      const consumerBundle = result.bundles.find((x) => x.name === "consumer")
      expect(consumerBundle?.manifests[0]).toEqual({ cm: "settings", sa: "worker", pvc: "data" })
    }))

  it("rejects two modules providing the same ConfigMap, ServiceAccount or Pvc", () => {
    const provider = <const N extends string, P>(name: N, provides: Layer.Layer<P>) =>
      define({ name: asLiteralName(name), namespace: "ns", build: () => [], provides })

    const cm = [provider("a", Dep.provideConfigMap("c")), provider("b", Dep.provideConfigMap("c"))] as const
    const sa = [provider("a", Dep.provideServiceAccount("s")), provider("b", Dep.provideServiceAccount("s"))] as const
    const pvc = [provider("a", Dep.providePvc("p")), provider("b", Dep.providePvc("p"))] as const

    // @ts-expect-error duplicate ConfigMap "c"
    fromModules({ modules: cm })
    // @ts-expect-error duplicate ServiceAccount "s"
    fromModules({ modules: sa })
    // @ts-expect-error duplicate Pvc "p"
    fromModules({ modules: pvc })
    // distinct names are fine
    fromModules({ modules: [provider("a", Dep.provideConfigMap("c")), provider("b", Dep.provideConfigMap("d"))] })
    expect(cm).toHaveLength(2)
  })

  it.effect("honors a custom result name", () =>
    Effect.gen(function*() {
      const m = define({ name: "m", namespace: "ns", build: () => [] })
      const result = yield* fromModules({ name: "platform", modules: [m] as const })
      expect(result.name).toBe("platform")
    }))
})
