import { NodeServices } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { RenderContext, type ResolvedKonfigConfig } from "@konfig.ts/core"
import { Cause, Effect, Exit, Predicate } from "effect"
import { FileSystem } from "effect/FileSystem"
import { Path } from "effect/Path"
import { renderEnv } from "./buildEnv"

const _writeEnvFile = (root: string, entry: string, body: string) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const path = yield* Path
    const full = path.join(root, entry)
    yield* fs.makeDirectory(path.dirname(full), { recursive: true })
    yield* fs.writeFileString(full, body)

    return full
  })

describe("renderEnv: BundleSetResult env", () => {
  it.effect("writes per-bundle directories with no Application CR sentinel", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const path = yield* Path
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-bundle-" })

      const envBody = `
import { Bundle } from "@konfig.ts/core";
import { ConfigMap } from "@konfig.ts/k8s";
const api = Bundle.define({
	name: "api",
	namespace: "app",
	build: () => [ConfigMap.make({ name: "api-conf", namespace: "app", data: { K: "v" } })],
});
export default Bundle.fromModules({ modules: [api] as const });
`

      yield* _writeEnvFile(root, "infra/env/test.ts", envBody)

      const cfg: ResolvedKonfigConfig = {
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
      }

      const ctx = RenderContext.make("test")

      const rendered = yield* renderEnv({ cfg, envName: "test", ctx })
      const filePaths = rendered.files.map((f) => path.relative(rendered.outDirAbs, f.path))
      const apiFiles = filePaths.filter((p) => p.startsWith("api/"))
      const applicationFiles = filePaths.filter((p) => p.includes("Application-"))
      expect(apiFiles.length).toBeGreaterThan(0)
      expect(applicationFiles).toEqual([])
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  const _renderBundle = (build: string) =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-bundle-err-" })

      const envBody = `
import { Bundle, Manifest } from "@konfig.ts/core";
const api = Bundle.define({ name: "api", namespace: "app", build: () => [${build}] });
export default Bundle.fromModules({ modules: [api] as const });
`

      yield* _writeEnvFile(root, "infra/env/test.ts", envBody)

      const cfg: ResolvedKonfigConfig = {
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
      }

      return yield* renderEnv({ cfg, envName: "test", ctx: RenderContext.make("test") }).pipe(Effect.exit)
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))

  const _malformed = ["a: [", String.raw`a: \"1\"\na: \"2\"`]

  it.effect("malformed embedded YAML fails typed instead of dying", () =>
    Effect.forEach(_malformed, (literal) =>
      Effect.gen(function*() {
        const exit = yield* _renderBundle(`Manifest.embedYaml({ literal: "${literal}" })`)

        expect(Exit.hasDies(exit)).toBe(false)
        const err = Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined

        expect(Predicate.isTagged(err, "YamlParseError")).toBe(true)
      })))
})
