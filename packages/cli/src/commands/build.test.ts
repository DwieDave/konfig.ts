import { NodeServices } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { RenderContext, type ResolvedKonfigConfig } from "@konfig.ts/core"
import { Effect } from "effect"
import { FileSystem } from "effect/FileSystem"
import { Path } from "effect/Path"
import { computeInputHash, readCacheEntry } from "../buildCache"
import { runBuild } from "./build"

/**
 * `outDir.manifests` points *outside* `root` (`../rendered`) so a build's
 * own written output never lands under the tree `computeInputHash` walks
 * — otherwise every build would perturb the next build's input hash and
 * no cache hit would ever be observable.
 */
const _cfgFor = (configDir: string): ResolvedKonfigConfig => ({
  configDir,
  config: {
    root: "infra",
    cluster: "cluster.ts",
    modules: "modules",
    charts: "charts",
    outDir: { manifests: "../rendered" },
    envs: {},
    crd: { outDir: ".generated/crd" },
    helm: { cacheDir: ".konfig/helm-cache", minVersion: "3.16.0" },
    cacheInclude: []
  }
})

const _bundleEnvBody = `
import { Bundle } from "@konfig.ts/core";
import { ConfigMap } from "@konfig.ts/k8s";
const api = Bundle.define({
	name: "api",
	namespace: "app",
	build: () => [ConfigMap.make({ name: "api-conf", namespace: "app", data: { K: "v" } })],
});
export default Bundle.fromModules({ modules: [api] as const });
`

const _writeBundleEnv = (root: string) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const path = yield* Path
    const entryDir = path.join(root, "infra", "env")
    yield* fs.makeDirectory(entryDir, { recursive: true })
    yield* fs.writeFileString(path.join(entryDir, "prod.ts"), _bundleEnvBody)
  })

describe("runBuild", () => {
  it.effect("renders a Bundle env, writes files to outDir, and records a cache entry", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const path = yield* Path
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-build-" })
      yield* _writeBundleEnv(root)
      const cfg = _cfgFor(root)
      const ctx = RenderContext.make("prod")

      yield* runBuild({
        cfg,
        envName: "prod",
        ctx,
        logFmt: "text",
        noCache: false
      })

      const outDir = path.join(root, "rendered", "prod")
      const configMapPath = path.join(outDir, "api", "ConfigMap-api-conf@app.yaml")
      const exists = yield* fs.exists(configMapPath)
      expect(exists).toBe(true)
      const content = yield* fs.readFileString(configMapPath)
      expect(content).toContain("kind: ConfigMap")
      expect(content).toContain("name: api-conf")

      const entry = yield* readCacheEntry({ cfg, envName: "prod", ctx })
      expect(entry).toBeDefined()
      expect(entry?.outDirAbs).toBe(outDir)
      expect(entry?.fileCount).toBe(1)
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("a second build with unchanged inputs is a cache hit — reuses the recorded file count", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-build-" })
      yield* _writeBundleEnv(root)
      const cfg = _cfgFor(root)
      const ctx = RenderContext.make("prod")

      yield* runBuild({ cfg, envName: "prod", ctx, logFmt: "text", noCache: false })
      const firstEntry = yield* readCacheEntry({ cfg, envName: "prod", ctx })

      // Second build: cache hit path returns without touching writeFiles/
      // writeCacheEntry again — the recorded timestamp must stay identical.
      yield* runBuild({ cfg, envName: "prod", ctx, logFmt: "text", noCache: false })
      const secondEntry = yield* readCacheEntry({ cfg, envName: "prod", ctx })

      expect(secondEntry).toEqual(firstEntry)
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("noCache: true skips the cache entirely — no cache file is written", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const path = yield* Path
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-build-" })
      yield* _writeBundleEnv(root)
      const cfg = _cfgFor(root)
      const ctx = RenderContext.make("prod")

      yield* runBuild({ cfg, envName: "prod", ctx, logFmt: "text", noCache: true })

      const outDir = path.join(root, "rendered", "prod")
      const exists = yield* fs.exists(path.join(outDir, "api", "ConfigMap-api-conf@app.yaml"))
      expect(exists).toBe(true)

      const entry = yield* readCacheEntry({ cfg, envName: "prod", ctx })
      expect(entry).toBeUndefined()
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("editing a cacheInclude input invalidates the cache — new entry gets a fresh input hash", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const path = yield* Path
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-build-" })
      yield* _writeBundleEnv(root)
      const sharedFile = path.join(root, "shared", "values.yaml")
      yield* fs.makeDirectory(path.join(root, "shared"), { recursive: true })
      yield* fs.writeFileString(sharedFile, "a: 1\n")

      const cfg: ResolvedKonfigConfig = {
        ..._cfgFor(root),
        config: { ..._cfgFor(root).config, cacheInclude: ["shared"] }
      }

      const ctx = RenderContext.make("prod")

      yield* runBuild({ cfg, envName: "prod", ctx, logFmt: "text", noCache: false })
      const firstEntry = yield* readCacheEntry({ cfg, envName: "prod", ctx })

      // A second build with nothing changed is a genuine cache hit —
      // rewriting nothing, so the entry stays byte-identical.
      yield* runBuild({ cfg, envName: "prod", ctx, logFmt: "text", noCache: false })
      const unchangedEntry = yield* readCacheEntry({ cfg, envName: "prod", ctx })
      expect(unchangedEntry).toEqual(firstEntry)

      // Editing the cacheInclude file (outside `root`, so it doesn't feed
      // the rendered output) still shifts the input hash and forces a
      // fresh writeCacheEntry with a new hash on the next build.
      yield* fs.writeFileString(sharedFile, "a: 2\n")
      yield* runBuild({ cfg, envName: "prod", ctx, logFmt: "text", noCache: false })
      const invalidatedEntry = yield* readCacheEntry({ cfg, envName: "prod", ctx })

      expect(invalidatedEntry?.inputHash).not.toBe(firstEntry?.inputHash)
      expect(invalidatedEntry?.outputHash).toBe(firstEntry?.outputHash)
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("a changed KONFIG_* env var invalidates the cache", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-build-env-" })
      yield* _writeBundleEnv(root)
      const cfg = _cfgFor(root)
      const ctx = RenderContext.make("prod")
      const probe = { cfg, envName: "prod", ctx }
      const key = "KONFIG_CACHE_PROBE_TEST"

      yield* Effect.acquireUseRelease(
        Effect.sync(() => {
          process.env[key] = "one"
        }),
        () =>
          Effect.gen(function*() {
            const first = yield* computeInputHash(probe)
            expect(yield* computeInputHash(probe)).toBe(first)
            process.env[key] = "two"
            expect(yield* computeInputHash(probe)).not.toBe(first)
          }),
        () =>
          Effect.sync(() => {
            delete process.env[key]
          })
      )
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("cluster output lands in a sibling <env>@<cluster> dir and never inside the cluster-less dir", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const path = yield* Path
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-build-cluster-" })
      yield* _writeBundleEnv(root)
      const cfg = _cfgFor(root)

      yield* runBuild({ cfg, envName: "prod", ctx: RenderContext.make("prod"), logFmt: "text", noCache: true })

      yield* runBuild({
        cfg,
        envName: "prod",
        ctx: RenderContext.makeFull({ env: "prod", cluster: "eu1", k8sVersion: undefined, flags: undefined }),
        logFmt: "text",
        noCache: true
      })

      const base = path.join(root, "rendered")
      expect(yield* fs.exists(path.join(base, "prod@eu1", "api", "ConfigMap-api-conf@app.yaml"))).toBe(true)
      expect(yield* fs.exists(path.join(base, "prod", "api", "ConfigMap-api-conf@app.yaml"))).toBe(true)
      expect(yield* fs.exists(path.join(base, "prod", "eu1"))).toBe(false)
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))
})
