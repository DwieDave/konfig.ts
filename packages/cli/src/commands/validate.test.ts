import { NodeServices } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { RenderContext, type ResolvedKonfigConfig } from "@konfig.ts/core"
import { Effect, Layer, Sink, Stream } from "effect"
import { FileSystem } from "effect/FileSystem"
import { Path } from "effect/Path"
import type { Command } from "effect/unstable/process/ChildProcess"
import {
  type ChildProcessHandle,
  ChildProcessSpawner,
  ExitCode,
  make as makeSpawner,
  makeHandle,
  ProcessId
} from "effect/unstable/process/ChildProcessSpawner"
import { runValidate, StructuralValidationFailed } from "./validate"

const _bytes = (s: string): Stream.Stream<Uint8Array> => Stream.make(new TextEncoder().encode(s))

interface _CapturedKubeconform {
  args: ReadonlyArray<string> | undefined
  // Files present under the directory kubeconform was pointed at, listed
  // while the process "runs" — i.e. before the scoped scratch dir is removed.
  filesInDir: ReadonlyArray<string> | undefined
}

// A fake `kubeconform` that exits 0 and records the args it was spawned
// with plus the contents of the directory it was pointed at.
const _kubeconformSpawner = (
  captured: _CapturedKubeconform
): Layer.Layer<ChildProcessSpawner, never, FileSystem> =>
  Layer.effect(
    ChildProcessSpawner,
    Effect.gen(function*() {
      const fs = yield* FileSystem
      return makeSpawner((command: Command) =>
        Effect.gen(function*() {
          const args = command._tag === "StandardCommand" ? command.args : []
          captured.args = args
          const dir = args[2]
          if (dir !== undefined) {
            captured.filesInDir = yield* fs.readDirectory(dir, { recursive: true }).pipe(
              Effect.orElseSucceed(() => [])
            )
          }
          return makeHandle({
            pid: ProcessId(1),
            exitCode: Effect.succeed(ExitCode(0)),
            isRunning: Effect.succeed(false),
            kill: () => Effect.void,
            stdin: Sink.drain,
            stdout: _bytes(""),
            stderr: _bytes(""),
            all: _bytes(""),
            getInputFd: () => Sink.drain,
            getOutputFd: () => Stream.empty,
            unref: Effect.succeed(Effect.void)
          }) as ChildProcessHandle
        })
      )
    })
  )

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

  it.effect(
    "--strict stages the fresh render into a scratch temp dir (not outDir) and forwards -kubernetes-version",
    () =>
      Effect.gen(function*() {
        const fs = yield* FileSystem
        const path = yield* Path
        const root = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-validate-" })
        yield* _writeEnv(root, "prod", _validBundleEnvBody)
        const cfg = _cfgFor(root)
        const ctx = RenderContext.makeFull({ env: "prod", k8sVersion: "1.29.0" })
        const captured: _CapturedKubeconform = { args: undefined, filesInDir: undefined }

        yield* runValidate({
          cfg,
          envName: "prod",
          ctx,
          strict: true,
          ignoreMissingSchemas: true
        }).pipe(Effect.provide(_kubeconformSpawner(captured)))

        const args = captured.args ?? []
        expect(args.slice(0, 2)).toEqual(["-summary", "-strict"])
        const scratchDir = args[2] ?? ""
        expect(path.basename(scratchDir).startsWith("konfig-validate-")).toBe(true)
        expect(scratchDir.startsWith(root)).toBe(false)
        expect(args.slice(3)).toEqual(["-ignore-missing-schemas", "-kubernetes-version", "1.29.0"])

        // The render was staged into the scratch dir while kubeconform ran...
        expect((captured.filesInDir ?? []).some((f) => f.endsWith(".yaml"))).toBe(true)
        // ...and cleaned up once the command finished.
        expect(yield* fs.exists(scratchDir)).toBe(false)
        // Nothing was written to the configured manifests outDir.
        expect(yield* fs.exists(path.join(root, "infra", "rendered"))).toBe(false)
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  )
})
