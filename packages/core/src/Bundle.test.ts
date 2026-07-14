import { NodeServices } from "@effect/platform-node"
import { describe, expect, it, layer } from "@effect/vitest"
import { Effect, Layer } from "effect"
import * as Bundle from "./Bundle"
import { define, entrypoint, fromModules } from "./Bundle"
import * as Dep from "./deps"

describe("Bundle.make", () => {
  it("constructs a Bundle with the given fields", () => {
    const b = Bundle.make({
      name: "api",
      namespace: "app",
      manifests: [{ kind: "ConfigMap", metadata: { name: "api-conf" } }]
    })
    expect(b.name).toBe("api")
    expect(b.namespace).toBe("app")
    expect(b.manifests).toHaveLength(1)
  })

  it("omits namespace when not provided", () => {
    const b = Bundle.make({ name: "cluster-scoped", manifests: [] })
    expect(b.namespace).toBeUndefined()
  })
})

describe("Bundle.define", () => {
  it("returns a yieldable handle whose value is the built Bundle", async () => {
    const handle = define({
      name: "api",
      namespace: "app",
      build: () => [{ kind: "ConfigMap", metadata: { name: "api-conf" } }]
    })

    const program = Effect.gen(function*() {
      const b = yield* handle
      expect(b.name).toBe("api")
      expect(b.namespace).toBe("app")
      expect(b.manifests).toHaveLength(1)
    })
    await Effect.runPromise(
      program.pipe(Effect.provide(handle.layer)) as Effect.Effect<void, never, never>
    )
  })

  it("supports an Effect-returning build that reads from a provided Layer", async () => {
    const handle = define({
      name: "consumer",
      namespace: "app",
      build: Effect.gen(function*() {
        const ref = yield* Dep.Secret("shared")
        return [{ kind: "ConfigMap", metadata: { name: ref } }]
      })
    })

    const providerLayer = Dep.provideSecret("shared")
    const program = Effect.gen(function*() {
      const b = yield* handle
      expect(b.manifests[0]).toEqual({
        kind: "ConfigMap",
        metadata: { name: "shared" }
      })
    })
    await Effect.runPromise(
      program.pipe(
        Effect.provide(Layer.provideMerge(handle.layer, providerLayer))
      ) as Effect.Effect<void, never, never>
    )
  })

  it("supports a cluster-scoped bundle with no namespace", async () => {
    const handle = define({
      name: "crds",
      build: () => [
        { kind: "CustomResourceDefinition", metadata: { name: "foos.example.com" } }
      ]
    })

    const program = Effect.gen(function*() {
      const b = yield* handle
      expect(b.namespace).toBeUndefined()
      expect(b.name).toBe("crds")
    })
    await Effect.runPromise(
      program.pipe(Effect.provide(handle.layer)) as Effect.Effect<void, never, never>
    )
  })
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

  it.effect("passes through entrypoint when every Need is met", () =>
    Effect.gen(function*() {
      const m = define({
        name: "m",
        namespace: "ns",
        build: () => []
      })
      const program = fromModules({ modules: [m] as const })
      const result = yield* entrypoint(program)
      expect(result.bundles[0]?.name).toBe("m")
    }))

  it.effect("honors a custom result name", () =>
    Effect.gen(function*() {
      const m = define({ name: "m", namespace: "ns", build: () => [] })
      const result = yield* fromModules({ name: "platform", modules: [m] as const })
      expect(result.name).toBe("platform")
    }))
})
