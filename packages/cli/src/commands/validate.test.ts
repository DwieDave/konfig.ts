import { NodeServices } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { RenderContext, type ResolvedKonfigConfig } from "@konfig.ts/core"
import { Effect } from "effect"
import { FileSystem } from "effect/FileSystem"
import { Path } from "effect/Path"
import { runValidate, StructuralValidationFailed } from "./validate"

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
    helm: { cacheDir: ".konfig/helm-cache", minVersion: "3.16.0" },
    cacheInclude: []
  }
})

const _validBundleEnvBody = `
import { Bundle } from "@konfig.ts/core";
import { ConfigMap } from "@konfig.ts/k8s";
const api = Bundle.define({
	name: "api",
	namespace: "app",
	build: () => [ConfigMap.make({ name: "api-conf", namespace: "app", data: { K: "v" } })],
});
export default Bundle.entrypoint(Bundle.fromModules({ modules: [api] as const }));
`

/**
 * A bundle emitting a `RawYaml` document whose Kubernetes name violates
 * the RFC 1123 DNS-label pattern (uppercase letters + underscore) — the
 * structural validator's envelope schema must reject it.
 */
const _invalidBundleEnvBody = `
import { Bundle, Manifest } from "@konfig.ts/core";
const api = Bundle.define({
	name: "api",
	namespace: "app",
	build: () => [Manifest.embedYaml({ literal: \`apiVersion: v1
kind: ConfigMap
metadata:
  name: Invalid_Name
  namespace: app
data:
  K: v
\` })],
});
export default Bundle.entrypoint(Bundle.fromModules({ modules: [api] as const }));
`

const _writeEnv = (root: string, envName: string, body: string) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const path = yield* Path
    const entryDir = path.join(root, "infra", "env")
    yield* fs.makeDirectory(entryDir, { recursive: true })
    yield* fs.writeFileString(path.join(entryDir, `${envName}.ts`), body)
  })

describe("runValidate", () => {
  it.effect("passes for a well-formed Bundle env — no issues, no failure", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-validate-" })
      yield* _writeEnv(root, "prod", _validBundleEnvBody)
      const cfg = _cfgFor(root)
      const ctx = RenderContext.make("prod")

      yield* runValidate({
        cfg,
        envName: "prod",
        ctx,
        strict: false,
        ignoreMissingSchemas: false
      })
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("fails with StructuralValidationFailed carrying the exact issue count for an invalid manifest", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-validate-" })
      yield* _writeEnv(root, "prod", _invalidBundleEnvBody)
      const cfg = _cfgFor(root)
      const ctx = RenderContext.make("prod")

      const failure = yield* runValidate({
        cfg,
        envName: "prod",
        ctx,
        strict: false,
        ignoreMissingSchemas: false
      }).pipe(Effect.flip)

      if (!(failure instanceof StructuralValidationFailed)) {
        throw new Error(`expected StructuralValidationFailed, got ${String(failure)}`)
      }
      expect(failure.env).toBe("prod")
      expect(failure.issueCount).toBe(1)
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))
})
