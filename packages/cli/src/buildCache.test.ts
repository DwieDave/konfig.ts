import { NodeServices } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { RenderContext, type ResolvedKonfigConfig } from "@konfig.ts/core"
import { Effect } from "effect"
import { FileSystem } from "effect/FileSystem"
import { Path } from "effect/Path"
import {
  type BuildCacheEntry,
  computeInputHash,
  computeOnDiskOutputHash,
  computeOutputHash,
  readCacheEntry,
  writeCacheEntry
} from "./buildCache"

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

const _cfgFor = (configDir: string, cacheInclude: readonly string[] = []): ResolvedKonfigConfig => ({
  configDir,
  config: {
    root: "infra",
    cluster: "cluster.ts",
    modules: "modules",
    charts: "charts",
    outDir: { manifests: "rendered" },
    envs: {},
    crd: { outDir: ".generated/crd" },
    helm: { cacheDir: ".konfig/helm-cache", minVersion: "3.16.0" },
    cacheInclude
  }
})

describe("computeInputHash: render-context sensitivity", () => {
  it.effect("a different k8sVersion is a cache MISS (distinct input hash) for identical files", () =>
    Effect.gen(function*() {
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
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("editing a non-.ts/.json/.yaml file (e.g. .sh) under root shifts the hash", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const path = yield* Path
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-cache-" })
      const cfg = _cfgFor(root)
      const infra = path.join(root, "infra")
      yield* fs.makeDirectory(infra, { recursive: true })
      const script = path.join(infra, "hook.sh")

      yield* fs.writeFileString(script, "echo one\n")
      const ctx = RenderContext.make("prod")
      const base = yield* computeInputHash({ cfg, envName: "prod", ctx })

      yield* fs.writeFileString(script, "echo two\n")
      const edited = yield* computeInputHash({ cfg, envName: "prod", ctx })

      expect(base).not.toBe(edited)
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("distinct binary contents under root shift the hash (no lossy UTF-8 collapse)", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const path = yield* Path
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-cache-" })
      const cfg = _cfgFor(root)
      const infra = path.join(root, "infra")
      yield* fs.makeDirectory(infra, { recursive: true })
      const blob = path.join(infra, "data.bin")

      yield* fs.writeFile(blob, new Uint8Array([0xff]))
      const ctx = RenderContext.make("prod")
      const base = yield* computeInputHash({ cfg, envName: "prod", ctx })

      yield* fs.writeFile(blob, new Uint8Array([0xfe]))
      const edited = yield* computeInputHash({ cfg, envName: "prod", ctx })

      expect(base).not.toBe(edited)
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("editing a cacheInclude file outside root shifts the hash; without cacheInclude it does not", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const path = yield* Path
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-cache-" })
      yield* fs.makeDirectory(path.join(root, "infra"), { recursive: true })
      const shared = path.join(root, "shared", "values.yaml")
      yield* fs.makeDirectory(path.join(root, "shared"), { recursive: true })
      yield* fs.writeFileString(shared, "a: 1\n")
      const ctx = RenderContext.make("prod")

      const withInclude = _cfgFor(root, ["shared"])
      const without = _cfgFor(root)
      const base = yield* computeInputHash({ cfg: withInclude, envName: "prod", ctx })
      const blindBase = yield* computeInputHash({ cfg: without, envName: "prod", ctx })

      yield* fs.writeFileString(shared, "a: 2\n")
      const edited = yield* computeInputHash({ cfg: withInclude, envName: "prod", ctx })
      const blindEdited = yield* computeInputHash({ cfg: without, envName: "prod", ctx })

      expect(base).not.toBe(edited)
      expect(blindBase).toBe(blindEdited)
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("cacheInclude glob pattern hashes matching files only", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const path = yield* Path
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-cache-" })
      yield* fs.makeDirectory(path.join(root, "infra"), { recursive: true })
      yield* fs.makeDirectory(path.join(root, "shared", "sub"), { recursive: true })
      const matched = path.join(root, "shared", "sub", "values.yaml")
      const unmatched = path.join(root, "shared", "sub", "notes.txt")
      yield* fs.writeFileString(matched, "a: 1\n")
      yield* fs.writeFileString(unmatched, "one\n")
      const cfg = _cfgFor(root, ["shared/**/*.yaml"])
      const ctx = RenderContext.make("prod")

      const base = yield* computeInputHash({ cfg, envName: "prod", ctx })

      yield* fs.writeFileString(unmatched, "two\n")
      const unmatchedEdit = yield* computeInputHash({ cfg, envName: "prod", ctx })
      expect(unmatchedEdit).toBe(base)

      yield* fs.writeFileString(matched, "a: 2\n")
      const matchedEdit = yield* computeInputHash({ cfg, envName: "prod", ctx })
      expect(matchedEdit).not.toBe(base)
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("cacheInclude accepts a single file path", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const path = yield* Path
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-cache-" })
      yield* fs.makeDirectory(path.join(root, "infra"), { recursive: true })
      const extra = path.join(root, "notes.txt")
      yield* fs.writeFileString(extra, "one\n")
      const cfg = _cfgFor(root, ["notes.txt"])
      const ctx = RenderContext.make("prod")

      const base = yield* computeInputHash({ cfg, envName: "prod", ctx })
      yield* fs.writeFileString(extra, "two\n")
      const edited = yield* computeInputHash({ cfg, envName: "prod", ctx })

      expect(base).not.toBe(edited)
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("differing cluster and flags each shift the hash", () =>
    Effect.gen(function*() {
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
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))
})

describe("readCacheEntry / writeCacheEntry", () => {
  it.effect("readCacheEntry returns undefined when no cache file exists (miss)", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-cache-rw-" })
      const cfg = _cfgFor(root)
      const ctx = RenderContext.make("prod")

      const entry = yield* readCacheEntry({ cfg, envName: "prod", ctx })
      expect(entry).toBeUndefined()
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("writeCacheEntry persists an entry that readCacheEntry then reads back verbatim", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-cache-rw-" })
      const cfg = _cfgFor(root)
      const ctx = RenderContext.make("prod")

      const written: BuildCacheEntry = {
        inputHash: "abc123",
        outputHash: "def456",
        outDirAbs: "/some/out/dir",
        fileCount: 3,
        timestamp: "2026-01-01T00:00:00.000Z"
      }
      yield* writeCacheEntry({ cfg, envName: "prod", ctx, entry: written })

      const read = yield* readCacheEntry({ cfg, envName: "prod", ctx })
      expect(read).toEqual(written)
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("readCacheEntry keys cache files by render-context signature: different ctx misses", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-cache-rw-ctx-" })
      const cfg = _cfgFor(root)

      const entry: BuildCacheEntry = {
        inputHash: "h1",
        outputHash: "h2",
        outDirAbs: "/out",
        fileCount: 1,
        timestamp: "2026-01-01T00:00:00.000Z"
      }
      yield* writeCacheEntry({ cfg, envName: "prod", ctx: RenderContext.make("prod"), entry })

      const differentCtx = yield* readCacheEntry({
        cfg,
        envName: "prod",
        ctx: RenderContext.makeFull({ env: "prod", cluster: "eu-1" })
      })
      expect(differentCtx).toBeUndefined()

      const sameCtx = yield* readCacheEntry({ cfg, envName: "prod", ctx: RenderContext.make("prod") })
      expect(sameCtx).toEqual(entry)
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("readCacheEntry tolerates a corrupt (non-JSON) cache file by returning undefined", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const path = yield* Path
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-cache-corrupt-" })
      const cfg = _cfgFor(root)
      const ctx = RenderContext.make("prod")

      // write a well-formed entry first, then corrupt the file directly to
      // exercise the JSON.parse failure path in readCacheEntry
      yield* writeCacheEntry({
        cfg,
        envName: "prod",
        ctx,
        entry: { inputHash: "h", outputHash: "h", outDirAbs: "/o", fileCount: 0, timestamp: "t" }
      })
      const cacheDir = path.join(root, ".konfig", "cache")
      const entries = yield* fs.readDirectory(cacheDir)
      const cacheFile = path.join(cacheDir, entries[0] ?? "")
      yield* fs.writeFileString(cacheFile, "{not valid json")

      const read = yield* readCacheEntry({ cfg, envName: "prod", ctx })
      expect(read).toBeUndefined()
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))
})

describe("build cache lifecycle: miss / hit / stale transitions", () => {
  const _entryFor = (
    inputHash: string,
    outputHash: string,
    outDirAbs: string
  ): BuildCacheEntry => ({
    inputHash,
    outputHash,
    outDirAbs,
    fileCount: 1,
    timestamp: "2026-01-01T00:00:00.000Z"
  })

  it.effect("miss: no cache entry on the first build for an env", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const path = yield* Path
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-lifecycle-miss-" })
      const cfg = _cfgFor(root)
      yield* fs.makeDirectory(path.join(root, "infra"), { recursive: true })
      const ctx = RenderContext.make("prod")

      const cached = yield* readCacheEntry({ cfg, envName: "prod", ctx })
      expect(cached).toBeUndefined()
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("hit: matching inputHash and matching on-disk outputHash validates the cache entry", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const path = yield* Path
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-lifecycle-hit-" })
      const cfg = _cfgFor(root)
      yield* fs.makeDirectory(path.join(root, "infra"), { recursive: true })
      const ctx = RenderContext.make("prod")

      const inputHash = yield* computeInputHash({ cfg, envName: "prod", ctx })

      const outDirAbs = path.join(root, "rendered", "prod")
      yield* fs.makeDirectory(outDirAbs, { recursive: true })
      yield* fs.writeFileString(path.join(outDirAbs, "a.yaml"), "kind: A\n")

      const outputHash = yield* computeOnDiskOutputHash(outDirAbs)
      const entry = _entryFor(inputHash, outputHash, outDirAbs)
      yield* writeCacheEntry({ cfg, envName: "prod", ctx, entry })

      const cached = yield* readCacheEntry({ cfg, envName: "prod", ctx })
      const currentInputHash = yield* computeInputHash({ cfg, envName: "prod", ctx })
      const currentOutputHash = yield* computeOnDiskOutputHash(outDirAbs)

      expect(cached?.inputHash).toBe(currentInputHash)
      expect(cached?.outputHash).toBe(currentOutputHash)
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("miss after edit: changing an input file under root invalidates a previously cached inputHash", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const path = yield* Path
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-lifecycle-edit-" })
      const cfg = _cfgFor(root)
      const entryFile = path.join(root, "infra", "env", "prod.ts")
      yield* fs.makeDirectory(path.dirname(entryFile), { recursive: true })
      yield* fs.writeFileString(entryFile, "export default 1;\n")
      const ctx = RenderContext.make("prod")

      const inputHash = yield* computeInputHash({ cfg, envName: "prod", ctx })
      const entry = _entryFor(inputHash, "irrelevant", path.join(root, "rendered", "prod"))
      yield* writeCacheEntry({ cfg, envName: "prod", ctx, entry })

      yield* fs.writeFileString(entryFile, "export default 2;\n")
      const newInputHash = yield* computeInputHash({ cfg, envName: "prod", ctx })
      const cached = yield* readCacheEntry({ cfg, envName: "prod", ctx })

      expect(cached?.inputHash).toBe(inputHash)
      expect(cached?.inputHash).not.toBe(newInputHash)
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("stale: matching inputHash but tampered on-disk output no longer matches the recorded outputHash", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const path = yield* Path
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-lifecycle-stale-" })
      const cfg = _cfgFor(root)
      yield* fs.makeDirectory(path.join(root, "infra"), { recursive: true })
      const ctx = RenderContext.make("prod")

      const inputHash = yield* computeInputHash({ cfg, envName: "prod", ctx })

      const outDirAbs = path.join(root, "rendered", "prod")
      yield* fs.makeDirectory(outDirAbs, { recursive: true })
      yield* fs.writeFileString(path.join(outDirAbs, "a.yaml"), "kind: A\n")
      const outputHash = yield* computeOnDiskOutputHash(outDirAbs)

      const entry = _entryFor(inputHash, outputHash, outDirAbs)
      yield* writeCacheEntry({ cfg, envName: "prod", ctx, entry })

      // out-of-band tamper of the rendered tree, bypassing konfig
      yield* fs.writeFileString(path.join(outDirAbs, "a.yaml"), "kind: TAMPERED\n")

      const cached = yield* readCacheEntry({ cfg, envName: "prod", ctx })
      const currentOutputHash = yield* computeOnDiskOutputHash(outDirAbs)

      expect(cached?.inputHash).toBe(inputHash)
      expect(cached?.outputHash).not.toBe(currentOutputHash)
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("computeOnDiskOutputHash reflects a deleted file (fileCount/hash change) vs. the recorded entry", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const path = yield* Path
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-lifecycle-delete-" })
      const outDirAbs = path.join(root, "rendered", "prod")
      yield* fs.makeDirectory(outDirAbs, { recursive: true })
      yield* fs.writeFileString(path.join(outDirAbs, "a.yaml"), "kind: A\n")
      yield* fs.writeFileString(path.join(outDirAbs, "b.yaml"), "kind: B\n")

      const before = yield* computeOnDiskOutputHash(outDirAbs)
      yield* fs.remove(path.join(outDirAbs, "b.yaml"))
      const after = yield* computeOnDiskOutputHash(outDirAbs)

      expect(before).not.toBe(after)
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))
})
