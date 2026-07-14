import { Dep } from "@konfig.ts/core"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { define } from "./Application"

describe("Application.define handle (Context.Tag + .layer)", () => {
  it("the returned handle yields the Application via Effect Context", async () => {
    const handle = define({
      name: "yield-test",
      namespace: "app",
      source: {
        repoURL: "https://example.com/repo",
        targetRevision: "main",
        path: "envs/test"
      },
      build: () => []
    })

    const program = Effect.gen(function*() {
      const app = yield* handle
      return app
    }).pipe(Effect.provide(handle.layer))

    const result = await Effect.runPromise(program)
    expect(result.name).toBe("yield-test")
    expect(result.namespace).toBe("app")
    expect(result.manifests).toEqual([])
  })

  it("handle.layer provides Application + Namespace deps", async () => {
    const handle = define({
      name: "layer-test",
      namespace: "foo-ns",
      source: { repoURL: "x", targetRevision: "main", path: "p" },
      build: () => []
    })

    const program = Effect.gen(function*() {
      const ns = yield* Dep.Namespace("foo-ns")
      const appName = yield* Dep.Application("layer-test")
      return { ns, appName }
    }).pipe(Effect.provide(handle.layer))

    const { ns, appName } = await Effect.runPromise(program)
    expect(ns).toBe("foo-ns")
    expect(appName).toBe("layer-test")
  })
})
