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

  it("editing a non-.ts/.json/.yaml file (e.g. .sh) under root shifts the hash", async () => {
    const program = Effect.gen(function*() {
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
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))

    await Effect.runPromise(program)
  })

  it("distinct binary contents under root shift the hash (no lossy UTF-8 collapse)", async () => {
    const program = Effect.gen(function*() {
      const fs = yield* FileSystem
      const path = yield* Path
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-cache-" })
      const cfg = _cfgFor(root)
      const infra = path.join(root, "infra")
      yield* fs.makeDirectory(infra, { recursive: true })
      const blob = path.join(infra, "data.bin")

      // 0xFF and 0xFE are both invalid standalone UTF-8; a lossy string
      // decode maps both to U+FFFD, collapsing the difference.
      yield* fs.writeFile(blob, new Uint8Array([0xff]))
      const ctx = RenderContext.make("prod")
      const base = yield* computeInputHash({ cfg, envName: "prod", ctx })

      yield* fs.writeFile(blob, new Uint8Array([0xfe]))
      const edited = yield* computeInputHash({ cfg, envName: "prod", ctx })

      expect(base).not.toBe(edited)
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))

    await Effect.runPromise(program)
  })

  it("editing a cacheInclude file outside root shifts the hash; without cacheInclude it does not", async () => {
    const program = Effect.gen(function*() {
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
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))

    await Effect.runPromise(program)
  })

  it("cacheInclude glob pattern hashes matching files only", async () => {
    const program = Effect.gen(function*() {
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
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))

    await Effect.runPromise(program)
  })

  it("cacheInclude accepts a single file path", async () => {
    const program = Effect.gen(function*() {
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
