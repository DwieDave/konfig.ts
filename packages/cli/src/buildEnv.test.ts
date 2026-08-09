import { NodeServices } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { RenderContext, type ResolvedKonfigConfig } from "@konfig.ts/core"
import { Effect } from "effect"
import { FileSystem } from "effect/FileSystem"
import { Path } from "effect/Path"
import { renderEnv, writeFiles } from "./buildEnv"

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
export default AppOfApps.entrypoint(AppOfApps.fromModules({
	target: { repoURL: "https://example.com/repo", branch: "main", rootPath: "envs/test" },
	defaults: { destination: { server: "https://kubernetes.default.svc" } },
	modules: [svc] as const,
}));
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
export default Bundle.entrypoint(Bundle.fromModules({ modules: [raw] as const }));
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
export default Bundle.entrypoint(Bundle.fromModules({ modules: [raw] as const }));
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
      expect(err._tag).toBe("EnvEntryNotFound")
      expect(err._tag === "EnvEntryNotFound" && err.env).toBe("missing")
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
      expect(typeof err.cause).toBe("string")
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
      expect(err._tag).toBe("EnvEntryNotFound")
      expect(err._tag === "EnvEntryNotFound" && err.entry.endsWith("custom/staging-entry.ts")).toBe(true)
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))
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
      const outDirAbs = path.join(root, "rendered", "test")

      const written = yield* writeFiles(_rendered(outDirAbs))
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
      const outDirAbs = path.join(root, "rendered", "test")
      const stagingDir = `${outDirAbs}.tmp`

      // simulate a prior interrupted run: leftover staging dir with a stale file
      // that must not survive into the final output
      yield* fs.makeDirectory(stagingDir, { recursive: true })
      yield* fs.writeFileString(path.join(stagingDir, "stale.yaml"), "stale: true\n")

      yield* writeFiles(_rendered(outDirAbs))

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
      const outDirAbs = path.join(root, "rendered", "test")

      // pre-existing live tree from a previous build, including a file that
      // the new render no longer produces
      yield* fs.makeDirectory(outDirAbs, { recursive: true })
      yield* fs.writeFileString(path.join(outDirAbs, "old.yaml"), "old: true\n")

      yield* writeFiles(_rendered(outDirAbs))

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
        const outDirAbs = path.join(root, "rendered", "test")

        const err = yield* writeFiles({ appsDirAbs: outDirAbs, outDirAbs, files: [] }).pipe(Effect.flip)
        expect(err._tag).toBe("WriteEnvError")
        expect(err.path).toBe(outDirAbs)
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  )
})
