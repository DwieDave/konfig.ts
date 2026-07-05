import { NodeServices } from "@effect/platform-node"
import { RenderContext, type ResolvedKonfigConfig } from "@konfig.ts/core"
import { Effect } from "effect"
import { FileSystem } from "effect/FileSystem"
import { Path } from "effect/Path"
import { describe, expect, it } from "vitest"
import { computeInputHash, computeOutputHash } from "./buildCache"

describe("computeOutputHash", () => {
  it("is deterministic regardless of input order", () => {
    const a = [
      { path: "out/a.yaml", content: "kind: A\n" },
      { path: "out/b.yaml", content: "kind: B\n" }
    ]
    const b = [
      { path: "out/b.yaml", content: "kind: B\n" },
      { path: "out/a.yaml", content: "kind: A\n" }
    ]
    expect(computeOutputHash(a)).toBe(computeOutputHash(b))
  })

  it("changes when any file content changes", () => {
    const base = computeOutputHash([{ path: "x.yaml", content: "a: 1\n" }])
    const flipped = computeOutputHash([{ path: "x.yaml", content: "a: 2\n" }])
    expect(base).not.toBe(flipped)
  })

  it("changes when any path changes", () => {
    const a = computeOutputHash([{ path: "x.yaml", content: "k\n" }])
    const b = computeOutputHash([{ path: "y.yaml", content: "k\n" }])
    expect(a).not.toBe(b)
  })

  it("returns a SHA-256 hex string", () => {
    const h = computeOutputHash([{ path: "x", content: "y" }])
    expect(h).toMatch(/^[0-9a-f]{64}$/)
  })
})

const _cfgFor = (configDir: string): ResolvedKonfigConfig => ({
  configDir,
  config: {
    root: "infra",
    cluster: "cluster.ts",
    modules: "modules",
    charts: "charts",
    outDir: { manifests: "rendered" },
    envs: {},
    crd: { outDir: ".generated/crd" },
    helm: { cacheDir: ".konfig/helm-cache", minVersion: "3.16.0" }
  }
})

describe("computeInputHash: render-context sensitivity", () => {
  it("a different k8sVersion is a cache MISS (distinct input hash) for identical files", async () => {
    const program = Effect.gen(function*() {
      const fs = yield* FileSystem
      const path = yield* Path
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-cache-" })
      const cfg = _cfgFor(root)

      const entryDir = path.join(root, "infra", "env")
      yield* fs.makeDirectory(entryDir, { recursive: true })
      yield* fs.writeFileString(path.join(entryDir, "prod.ts"), "export default 1;\n")

      const base = yield* computeInputHash({
        cfg,
        envName: "prod",
        ctx: RenderContext.makeFull({ env: "prod", k8sVersion: "1.30" })
      })
      const bumped = yield* computeInputHash({
        cfg,
        envName: "prod",
        ctx: RenderContext.makeFull({ env: "prod", k8sVersion: "1.31" })
      })
      const same = yield* computeInputHash({
        cfg,
        envName: "prod",
        ctx: RenderContext.makeFull({ env: "prod", k8sVersion: "1.30" })
      })

      expect(base).not.toBe(bumped)
      expect(base).toBe(same)
      return { base, bumped }
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))

    await Effect.runPromise(program)
  })

  it("differing cluster and flags each shift the hash", async () => {
    const program = Effect.gen(function*() {
      const fs = yield* FileSystem
      const path = yield* Path
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-cache-" })
      const cfg = _cfgFor(root)
      yield* fs.makeDirectory(path.join(root, "infra"), { recursive: true })

      const plain = yield* computeInputHash({
        cfg,
        envName: "prod",
        ctx: RenderContext.make("prod")
      })
      const withCluster = yield* computeInputHash({
        cfg,
        envName: "prod",
        ctx: RenderContext.makeFull({ env: "prod", cluster: "eu-1" })
      })
      const withFlags = yield* computeInputHash({
        cfg,
        envName: "prod",
        ctx: RenderContext.makeFull({ env: "prod", flags: new Map([["canary", "on"]]) })
      })

      expect(new Set([plain, withCluster, withFlags]).size).toBe(3)
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))

    await Effect.runPromise(program)
  })
})
