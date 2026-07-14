import { NodeServices } from "@effect/platform-node"
import { expect, layer } from "@effect/vitest"
import { Dep } from "@konfig.ts/core"
import { Effect, Layer } from "effect"
import { define } from "./Application"
import { entrypoint, fromModules } from "./AppOfApps"

const src = (name: string) => ({
  repoURL: "https://example.com/repo",
  targetRevision: "main",
  path: `envs/test/${name}`
})

const target = {
  repoURL: "https://example.com/repo",
  branch: "main",
  rootPath: "envs/test"
}

const defaults = {
  destination: { server: "https://kubernetes.default.svc" }
}

layer(NodeServices.layer)("AppOfApps.fromModules", (it) => {
  it.effect("composes modules in listed order and merges their layers", () =>
    Effect.gen(function*() {
      const a = define({
        name: "a",
        namespace: "ns-a",
        source: src("a"),
        build: () => [{ kind: "ConfigMap", metadata: { name: "a" } }]
      })
      const b = define({
        name: "b",
        namespace: "ns-b",
        source: src("b"),
        build: () => [{ kind: "ConfigMap", metadata: { name: "b" } }]
      })
      const c = define({
        name: "c",
        namespace: "ns-c",
        source: src("c"),
        build: () => [{ kind: "ConfigMap", metadata: { name: "c" } }]
      })

      const program = fromModules({
        target,
        defaults,
        modules: [a, b, c] as const
      })

      const result = yield* program
      expect(result.target).toEqual(target)
      expect(result.defaults).toEqual(defaults)
      expect(result.apps.map((app) => app.name)).toEqual(["a", "b", "c"])
      expect(result.apps[0]?.manifests[0]).toEqual({
        kind: "ConfigMap",
        metadata: { name: "a" }
      })
    }))

  it.effect("topo-sorts the merged layer so a consumer's Need is met by a sibling's Provide", () =>
    Effect.gen(function*() {
      const provider = define({
        name: "provider",
        namespace: "infra",
        source: src("provider"),
        build: () => [],
        provides: Layer.succeed(Dep.Secret("shared"))("shared" as Dep.SecretRef<"shared">)
      })

      const consumer = define({
        name: "consumer",
        namespace: "app",
        source: src("consumer"),
        build: Effect.gen(function*() {
          const ref = yield* Dep.Secret("shared")
          return [{ kind: "ConfigMap", metadata: { name: ref } }]
        })
      })

      const program = fromModules({
        target,
        defaults,
        modules: [provider, consumer] as const
      })

      const result = yield* program
      expect(result.apps).toHaveLength(2)
      const consumerApp = result.apps.find((a) => a.name === "consumer")
      expect(consumerApp?.manifests[0]).toEqual({
        kind: "ConfigMap",
        metadata: { name: "shared" }
      })
    }))

  it.effect("passes through entrypoint when every Need is met (type-level check is the test)", () =>
    Effect.gen(function*() {
      const m = define({
        name: "m",
        namespace: "ns",
        source: src("m"),
        build: () => []
      })

      const program = fromModules({ target, defaults, modules: [m] as const })
      const wrapped = entrypoint(program)
      const result = yield* wrapped
      expect(result.apps[0]?.name).toBe("m")
    }))

  it.effect("honors a custom AppOfApps name", () =>
    Effect.gen(function*() {
      const m = define({
        name: "m",
        namespace: "ns",
        source: src("m"),
        build: () => []
      })

      const program = fromModules({
        name: "root-apps",
        target,
        defaults,
        modules: [m] as const
      })
      const result = yield* program
      expect(result.name).toBe("root-apps")
    }))

  it("rejects two modules sharing an app name at compile time", () => {
    const apiV1 = define({
      name: "api",
      namespace: "app",
      source: src("api"),
      build: () => []
    })
    const apiV2 = define({
      name: "api",
      namespace: "app",
      source: src("api"),
      build: () => []
    })
    // @ts-expect-error — duplicate App "api": the later module would silently shadow the earlier.
    fromModules({ target, defaults, modules: [apiV1, apiV2] as const })
    // distinct names sharing a namespace stay accepted
    const web = define({
      name: "web",
      namespace: "app",
      source: src("web"),
      build: () => []
    })
    const ok = fromModules({ target, defaults, modules: [apiV1, web] as const })
    expect(Effect.isEffect(ok)).toBe(true)
  })
})
