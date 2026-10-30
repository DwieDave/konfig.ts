import { NodeServices } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { RenderContext, type ResolvedKonfigConfig } from "@konfig.ts/core"
import { Effect, Option, Predicate, Schema } from "effect"
import { FileSystem } from "effect/FileSystem"
import { Path } from "effect/Path"
import fc from "fast-check"
import { vi } from "vitest"
import { _collectOutputs, _findOutputCollisions, envOutDir, renderEnv, writeFiles } from "./buildEnv"
import { _clusterName, _envName, withRenderContext } from "./renderContextFlags"

const _writeEnvFile = (root: string, entry: string, body: string) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const path = yield* Path
    const full = path.join(root, entry)
    yield* fs.makeDirectory(path.dirname(full), { recursive: true })
    yield* fs.writeFileString(full, body)

    return full
  })

const _cfgFor = (root: string): ResolvedKonfigConfig => ({
  configDir: root,
  config: {
    root: "infra",
    cluster: "cluster.ts",
    modules: "modules",
    charts: "charts",
    outDir: { manifests: "rendered" },
    envs: {},
    crd: { outDir: ".generated/crd" },
    helm: { cacheDir: ".konfig/helm-cache", minVersion: "3.16.0" },
    cacheInclude: []
  }
})

describe("renderEnv: AppOfApps env", () => {
  it.effect("writes per-app manifests plus an Application-<name>.yaml sentinel per app", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const path = yield* Path
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-argo-" })

      const envBody = `
import { Application, AppOfApps } from "@konfig.ts/argocd";
import { ConfigMap } from "@konfig.ts/k8s";
const svc = Application.define({
	name: "svc",
	namespace: "app",
	source: { repoURL: "https://example.com/repo", targetRevision: "main", path: "envs/test/svc" },
	build: () => [ConfigMap.make({ name: "svc-conf", namespace: "app", data: { K: "v" } })],
});
export default AppOfApps.fromModules({
	target: { repoURL: "https://example.com/repo", branch: "main", rootPath: "envs/test" },
	defaults: { destination: { server: "https://kubernetes.default.svc" } },
	modules: [svc] as const,
});
`

      yield* _writeEnvFile(root, "infra/env/test.ts", envBody)

      const cfg = _cfgFor(root)
      const ctx = RenderContext.make("test")

      const rendered = yield* renderEnv({ cfg, envName: "test", ctx })
      const filePaths = rendered.files.map((f) => path.relative(rendered.outDirAbs, f.path))
      const configMapFiles = filePaths.filter((p) => p.startsWith("svc/") && p.includes("ConfigMap-svc-conf"))
      const applicationFiles = filePaths.filter((p) => p.includes("Application-svc"))
      expect(configMapFiles.length).toBeGreaterThan(0)
      expect(applicationFiles.length).toBe(1)
      // the Application sentinel lives under appsDirAbs, not under the child's own subdirectory
      expect(applicationFiles[0]?.startsWith("svc/")).toBe(false)
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("splits multi-document RawYaml into one file per document, keyed by kind+name", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const path = yield* Path
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-rawyaml-" })

      const envBody = `
import { Bundle, Manifest } from "@konfig.ts/core";
const raw = Bundle.define({
	name: "raw",
	namespace: "app",
	build: () => [Manifest.embedYaml({
		literal: "kind: ConfigMap\\nmetadata:\\n  name: one\\n---\\nkind: ConfigMap\\nmetadata:\\n  name: two\\n"
	})],
});
export default Bundle.fromModules({ modules: [raw] as const });
`

      yield* _writeEnvFile(root, "infra/env/test.ts", envBody)

      const cfg = _cfgFor(root)
      const ctx = RenderContext.make("test")

      const rendered = yield* renderEnv({ cfg, envName: "test", ctx })
      const filePaths = rendered.files.map((f) => path.relative(rendered.outDirAbs, f.path)).sort()
      expect(filePaths.some((p) => p.includes("one"))).toBe(true)
      expect(filePaths.some((p) => p.includes("two"))).toBe(true)
      expect(filePaths.length).toBe(2)
      const contents = rendered.files.map((f) => f.content)
      expect(contents.some((c) => c.includes("name: one"))).toBe(true)
      expect(contents.some((c) => c.includes("name: two"))).toBe(true)
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("skips a RawYaml document with neither string kind nor string metadata.name", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-rawyaml-skip-" })

      const envBody = `
import { Bundle, Manifest } from "@konfig.ts/core";
const raw = Bundle.define({
	name: "raw",
	namespace: "app",
	build: () => [Manifest.embedYaml({
		literal: "justAString: true\\n---\\nkind: ConfigMap\\nmetadata:\\n  name: kept\\n"
	})],
});
export default Bundle.fromModules({ modules: [raw] as const });
`

      yield* _writeEnvFile(root, "infra/env/test.ts", envBody)

      const cfg = _cfgFor(root)
      const ctx = RenderContext.make("test")

      const rendered = yield* renderEnv({ cfg, envName: "test", ctx })
      expect(rendered.files.length).toBe(1)
      expect(rendered.files[0]?.content.includes("kept")).toBe(true)
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))
})

describe("renderEnv: env-entry error paths", () => {
  it.effect("EnvEntryNotFound when no entry file exists for the env and no explicit envSpec", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-noentry-" })
      const cfg = _cfgFor(root)
      const ctx = RenderContext.make("missing")

      const err = yield* renderEnv({ cfg, envName: "missing", ctx }).pipe(Effect.flip)
      expect(Predicate.isTagged(err, "EnvEntryNotFound")).toBe(true)
      expect(err).toMatchObject({ env: "missing" })
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("EnvLoadError when the entry's default export is missing", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-nodefault-" })
      yield* _writeEnvFile(root, "infra/env/test.ts", "export const notDefault = 1;\n")

      const cfg = _cfgFor(root)
      const ctx = RenderContext.make("test")

      const err = yield* renderEnv({ cfg, envName: "test", ctx }).pipe(Effect.flip)
      expect(err._tag).toBe("EnvLoadError")
      expect(err.cause).toBe("default export is missing")
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("EnvLoadError when the default export is not an Effect", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-noteffect-" })
      yield* _writeEnvFile(root, "infra/env/test.ts", "export default { apps: [] };\n")

      const cfg = _cfgFor(root)
      const ctx = RenderContext.make("test")

      const err = yield* renderEnv({ cfg, envName: "test", ctx }).pipe(Effect.flip)
      expect(err._tag).toBe("EnvLoadError")
      expect(err.cause).toBeTypeOf("string")
      expect(String(err.cause)).toContain("not an Effect")
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("EnvEntryNotFound resolves against cfg.config.envs[envName].entry when explicitly configured", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-explicit-entry-" })

      const cfg: ResolvedKonfigConfig = {
        ..._cfgFor(root),
        config: { ..._cfgFor(root).config, envs: { staging: { entry: "custom/staging-entry.ts" } } }
      }

      const ctx = RenderContext.make("staging")

      const err = yield* renderEnv({ cfg, envName: "staging", ctx }).pipe(Effect.flip)
      expect(Predicate.isTagged(err, "EnvEntryNotFound")).toBe(true)
      expect(err).toMatchObject({ entry: expect.stringMatching(/custom\/staging-entry\.ts$/) })
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))
})

const _bundleEnv = (build: string) => `
import { Bundle, Manifest } from "@konfig.ts/core";
import { ConfigMap } from "@konfig.ts/k8s";
const api = Bundle.define({ name: "api", namespace: "app", build: () => ${build} });
export default Bundle.fromModules({ modules: [api] as const });
`

const _renderFlipped = (body: string) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const root = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-env-err-" })
    yield* _writeEnvFile(root, "infra/env/test.ts", body)

    return yield* renderEnv({ cfg: _cfgFor(root), envName: "test", ctx: RenderContext.make("test") }).pipe(Effect.flip)
  })

describe("renderEnv: output file safety", () => {
  it.effect("same kind+name in two namespaces fails with OutputFileCollision listing both objects", () =>
    Effect.gen(function*() {
      const err = yield* _renderFlipped(
        _bundleEnv(
          `[ConfigMap.make({ name: "c", namespace: "a", data: { K: "1" } }), ConfigMap.make({ name: "c", namespace: "b", data: { K: "1" } })]`
        )
      )

      expect(err._tag).toBe("OutputFileCollision")
      expect(String(err.message)).toContain("ConfigMap a/c")
      expect(String(err.message)).toContain("ConfigMap b/c")
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("an empty metadata.name fails with InvalidOutputObject instead of throwing", () =>
    Effect.gen(function*() {
      const err = yield* _renderFlipped(
        _bundleEnv(`[Manifest.embedYaml({ literal: "apiVersion: v1\\nkind: ConfigMap\\nmetadata:\\n  name: ''\\n" })]`)
      )

      expect(err._tag).toBe("InvalidOutputObject")
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("a default export Effect with the wrong result shape fails with EnvResultInvalid", () =>
    Effect.gen(function*() {
      const err = yield* _renderFlipped(
        `import { Effect } from "effect";\nexport default Effect.succeed({ name: 5 });\n`
      )

      expect(err._tag).toBe("EnvResultInvalid")
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))
})

describe("_findOutputCollisions", () => {
  const _seg = fc.stringMatching(/^[a-z]{1,6}$/)

  it("property: distinct paths never collide", () => {
    fc.assert(
      fc.property(fc.uniqueArray(_seg, { minLength: 1, maxLength: 6 }), (names) => {
        const files = names.map((n) => ({ path: `/o/${n}.yaml`, content: n }))
        expect(_findOutputCollisions(files)).toEqual([])
      })
    )
  })

  it("property: the same path with differing content is reported once, identical content is not", () => {
    fc.assert(
      fc.property(_seg, _seg, _seg, (name, a, b) => {
        const path = `/o/${name}.yaml`

        const differing = _findOutputCollisions([{ path, content: `${a}1`, object: "x" }, {
          path,
          content: `${a}2`,
          object: "y"
        }])

        expect(differing).toEqual([{ path, objects: ["x", "y"] }])
        expect(_findOutputCollisions([{ path, content: b }, { path, content: b }])).toEqual([])
      })
    )
  })
})

describe("writeFiles: atomic staging", () => {
  const _rendered = (outDirAbs: string) => ({
    appsDirAbs: outDirAbs,
    outDirAbs,
    files: [
      { path: `${outDirAbs}/a.yaml`, content: "a: 1\n" },
      { path: `${outDirAbs}/nested/b.yaml`, content: "b: 2\n" }
    ]
  })

  it.effect("stages then renames into place, producing the expected files with expected content", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const path = yield* Path
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-write-" })
      const outDirAbs = path.join(root, "infra", "rendered", "test")

      const written = yield* writeFiles({ rendered: _rendered(outDirAbs), cfg: _cfgFor(root) })
      expect(written.length).toBe(2)

      const aContent = yield* fs.readFileString(path.join(outDirAbs, "a.yaml"))
      const bContent = yield* fs.readFileString(path.join(outDirAbs, "nested", "b.yaml"))
      expect(aContent).toBe("a: 1\n")
      expect(bContent).toBe("b: 2\n")

      const stagingExists = yield* fs.exists(`${outDirAbs}.tmp`)
      expect(stagingExists).toBe(false)
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("wipes a leftover .tmp staging dir from a prior interrupted run before writing", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const path = yield* Path
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-write-leftover-" })
      const outDirAbs = path.join(root, "infra", "rendered", "test")
      const stagingDir = `${outDirAbs}.tmp`

      // simulate a prior interrupted run: leftover staging dir with a stale file
      // that must not survive into the final output
      yield* fs.makeDirectory(stagingDir, { recursive: true })
      yield* fs.writeFileString(path.join(stagingDir, "stale.yaml"), "stale: true\n")

      yield* writeFiles({ rendered: _rendered(outDirAbs), cfg: _cfgFor(root) })

      const staleExists = yield* fs.exists(path.join(outDirAbs, "stale.yaml"))
      expect(staleExists).toBe(false)
      const aContent = yield* fs.readFileString(path.join(outDirAbs, "a.yaml"))
      expect(aContent).toBe("a: 1\n")
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("replaces a pre-existing live output dir rather than merging with stale content", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const path = yield* Path
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-write-replace-" })
      const outDirAbs = path.join(root, "infra", "rendered", "test")

      // pre-existing live tree from a previous build, including a file that
      // the new render no longer produces
      yield* fs.makeDirectory(outDirAbs, { recursive: true })
      yield* fs.writeFileString(path.join(outDirAbs, "old.yaml"), "old: true\n")

      yield* writeFiles({ rendered: _rendered(outDirAbs), cfg: _cfgFor(root) })

      const oldExists = yield* fs.exists(path.join(outDirAbs, "old.yaml"))
      expect(oldExists).toBe(false)
      const aContent = yield* fs.readFileString(path.join(outDirAbs, "a.yaml"))
      expect(aContent).toBe("a: 1\n")
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect(
    "writing an empty file set fails to rename (staging dir is never created when there are no files)",
    () =>
      Effect.gen(function*() {
        const fs = yield* FileSystem
        const path = yield* Path
        const root = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-write-empty-" })
        const outDirAbs = path.join(root, "infra", "rendered", "test")

        const rendered = { appsDirAbs: outDirAbs, outDirAbs, files: [] }
        const err = yield* writeFiles({ rendered, cfg: _cfgFor(root) }).pipe(Effect.flip)

        expect(err._tag).toBe("WriteEnvError")
        expect(err).toMatchObject({ path: outDirAbs })
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  )
})

describe("writeFiles: manifests-root guard", () => {
  it.effect("refuses an outDir that is not strictly inside the manifests root and removes nothing", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const path = yield* Path
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-write-guard-" })
      const cfg = _cfgFor(root)
      yield* fs.writeFileString(path.join(root, "konfig.json"), "{}")

      const outsiders = [root, path.join(root, "infra"), path.join(root, "infra", "rendered"), path.dirname(root)]

      yield* Effect.forEach(outsiders, (outDirAbs) =>
        Effect.gen(function*() {
          const err = yield* writeFiles({ rendered: { appsDirAbs: outDirAbs, outDirAbs, files: [] }, cfg }).pipe(
            Effect.flip
          )

          expect(err._tag).toBe("OutDirOutsideManifests")
        }))

      expect(yield* fs.exists(path.join(root, "konfig.json"))).toBe(true)
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))
})

describe("envOutDir", () => {
  const _outDir = (input: { readonly envName: string; readonly cluster: string | undefined }) =>
    envOutDir({
      cfg: _cfgFor("/cfg"),
      envName: input.envName,
      ctx: RenderContext.makeFull({
        env: input.envName,
        cluster: input.cluster,
        k8sVersion: undefined,
        flags: undefined
      })
    }).pipe(Effect.provide(NodeServices.layer), Effect.runPromise)

  it("property: any accepted env/cluster pair stays strictly inside the manifests root", async () => {
    const isEnv = Schema.is(_envName)
    const isCluster = Schema.is(_clusterName)

    await fc.assert(
      fc.asyncProperty(fc.string(), fc.option(fc.string(), { nil: undefined }), async (envName, cluster) => {
        fc.pre(isEnv(envName) && (cluster === undefined || isCluster(cluster)))
        const out = await _outDir({ envName, cluster })
        expect(out.startsWith("/cfg/infra/rendered/")).toBe(true)
        expect(out.slice("/cfg/infra/rendered/".length)).not.toMatch(/[/\\]|^\.\.?$/)
      }),
      { numRuns: 300 }
    )
  })

  it("rejects path-traversal cluster strings", () => {
    const isCluster = Schema.is(_clusterName)
    expect(["../../..", "..", ".", "a/b", "A", "-a", ""].some(isCluster)).toBe(false)
    expect(isCluster("eu-west-1")).toBe(true)
  })

  it("withRenderContext rejects a traversal cluster without running", async () => {
    const ran = vi.fn()

    const exit = await withRenderContext({
      args: { env: "prod", cluster: Option.some("../../.."), k8sVersion: Option.none(), flag: Option.none() },
      run: () => Effect.sync(ran)
    }).pipe(Effect.provide(NodeServices.layer), Effect.runPromiseExit)

    expect(exit._tag).toBe("Failure")
    expect(ran).not.toHaveBeenCalled()
  })

  it("places cluster output in a sibling <env>@<cluster> dir", async () => {
    expect(await _outDir({ envName: "prod", cluster: "eu1" })).toBe("/cfg/infra/rendered/prod@eu1")
    expect(await _outDir({ envName: "prod", cluster: undefined })).toBe("/cfg/infra/rendered/prod")
  })
})

describe("_collectOutputs: kind/name routing", () => {
  interface Doc {
    readonly kind?: string
    readonly justAString?: boolean
    readonly metadata?: { readonly name: string }
  }

  const _collect = (value: Doc) =>
    _collectOutputs({ value, appDir: "/out/app" }).pipe(Effect.provide(NodeServices.layer), Effect.runPromise)

  it("property: an object with a kind yields exactly one file or an InvalidOutputObject error", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.stringMatching(/^[A-Za-z]{1,8}$/),
        fc.option(fc.stringMatching(/^[a-z]{1,8}$/), { nil: undefined }),
        async (kind, name) => {
          const doc = name === undefined ? { kind } : { kind, metadata: { name } }

          const outcome = await _collect(doc).then(
            (files) => files.length,
            (error) => error?.error?._tag ?? error?._tag
          )

          expect(outcome === 1 || outcome === "InvalidOutputObject").toBe(true)
          expect(outcome === 1).toBe(name !== undefined)
        }
      ),
      { numRuns: 100 }
    )
  })

  it("skips only documents with neither kind nor metadata.name", async () => {
    expect(await _collect({ justAString: true })).toEqual([])
  })
})
