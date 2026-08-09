import { NodeServices } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { ConfigProvider, Effect, Exit, Layer, Option, Schema, Sink, Stream } from "effect"
import { FileSystem } from "effect/FileSystem"
import { Path } from "effect/Path"
import { type Command, isStandardCommand } from "effect/unstable/process/ChildProcess"
import {
  type ChildProcessHandle,
  ChildProcessSpawner,
  ExitCode,
  make as makeSpawner,
  makeHandle,
  ProcessId
} from "effect/unstable/process/ChildProcessSpawner"
import { CrdDrift, crdExtractEffect, crdVerifyEffect, MissingCrdFlags, ReleaseNotFound } from "./crd"

const _bytes = (s: string): Stream.Stream<Uint8Array> => Stream.make(new TextEncoder().encode(s))

const _handle = (proc: { stdout?: string; stderr?: string; exitCode?: number }): ChildProcessHandle =>
  makeHandle(
    {
      pid: ProcessId(4242),
      exitCode: Effect.succeed(ExitCode(proc.exitCode ?? 0)),
      isRunning: Effect.succeed(false),
      kill: () => Effect.void,
      stdin: Sink.drain,
      stdout: _bytes(proc.stdout ?? ""),
      stderr: _bytes(proc.stderr ?? ""),
      all: _bytes((proc.stdout ?? "") + (proc.stderr ?? "")),
      getInputFd: () => Sink.drain,
      getOutputFd: () => Stream.empty,
      unref: Effect.succeed(Effect.void)
    } as Parameters<typeof makeHandle>[0]
  )

/**
 * Fake `helm` spawner covering every subcommand the crd command path
 * shells out to: `version --short` (preflight), `pull`/`pull --untar`
 * (chart fetch/crds-dir scan) and `template` (the CRD YAML source).
 */
const _helmSpawner = (templateStdout: string): Layer.Layer<ChildProcessSpawner> =>
  Layer.succeed(
    ChildProcessSpawner,
    makeSpawner((command: Command) => {
      const args = isStandardCommand(command) ? command.args : []
      if (args.includes("version")) {
        return Effect.succeed(_handle({ stdout: "v3.16.0\n", exitCode: 0 }))
      }
      if (args.includes("template")) {
        return Effect.succeed(_handle({ stdout: templateStdout, exitCode: 0 }))
      }
      return Effect.succeed(_handle({ stdout: "", exitCode: 0 }))
    })
  )

const _validCrdYaml = `
apiVersion: apiextensions.k8s.io/v1
kind: CustomResourceDefinition
metadata:
  name: widgets.example.com
spec:
  group: example.com
  versions:
    - name: v1
      schema:
        openAPIV3Schema:
          type: object
          properties:
            size:
              type: string
`

const _testLayer = Layer.merge(NodeServices.layer, _helmSpawner(_validCrdYaml))

const _writeChartFile = (root: string, name: string, body: string) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const path = yield* Path
    yield* fs.writeFileString(path.join(root, name), body)
  })

/**
 * Points `resolveCliPaths`'s Config lookups at a scoped temp config
 * tree for the duration of `effect`, via an explicit `ConfigProvider`
 * rather than mutating global `process.env` — safe under vitest's
 * concurrent test execution within a single file.
 */
const _withCliPathsEnv = <A, E, R>(
  env: { readonly chartsDir: string; readonly outDir: string; readonly cacheDir: string },
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, E, R> =>
  effect.pipe(
    Effect.provideService(
      ConfigProvider.ConfigProvider,
      ConfigProvider.fromEnvRecord({
        KONFIG_CHARTS_DIR: env.chartsDir,
        KONFIG_CRD_OUT_DIR: env.outDir,
        KONFIG_HELM_CACHE: env.cacheDir,
        KONFIG_HELM_MIN_VERSION: "3.16.0"
      })
    )
  )

const _makeChartsDir = () =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const chartsDir = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-crdcmd-charts-" })
    yield* _writeChartFile(
      chartsDir,
      "widgets.ts",
      `
export const chart = {
  _konfigHelmRelease: true,
  id: "widgets",
  repo: "https://charts.example.com/repo",
  chart: "widgets-chart",
  version: "1.0.0"
}
`
    )
    return chartsDir
  })

const _emptyFlags = { release: Option.none<string>(), all: false }

describe("crdExtractEffect", () => {
  it.effect("extracts CRDs for the named --release and writes the generated file", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const path = yield* Path
      const chartsDir = yield* _makeChartsDir()
      const outDir = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-crdcmd-out-" })
      const cacheDir = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-crdcmd-cache-" })

      yield* _withCliPathsEnv(
        { chartsDir, outDir, cacheDir },
        crdExtractEffect({ release: Option.some("widgets"), all: false })
      )

      const content = yield* fs.readFileString(path.join(outDir, "widgets.ts"))
      expect(content).toContain("WidgetsInput")
    }).pipe(Effect.scoped, Effect.provide(_testLayer)))

  it.effect("fails with ReleaseNotFound for an unknown --release id", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const chartsDir = yield* _makeChartsDir()
      const outDir = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-crdcmd-out-" })
      const cacheDir = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-crdcmd-cache-" })

      const failure = yield* _withCliPathsEnv(
        { chartsDir, outDir, cacheDir },
        Effect.flip(crdExtractEffect({ release: Option.some("does-not-exist"), all: false }))
      )

      expect(failure).toBeInstanceOf(ReleaseNotFound)
      if (failure instanceof ReleaseNotFound) {
        expect(failure.releaseId).toBe("does-not-exist")
      }
    }).pipe(Effect.scoped, Effect.provide(_testLayer)))

  it.effect("fails with MissingCrdFlags when neither --release nor --all is given", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const chartsDir = yield* _makeChartsDir()
      const outDir = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-crdcmd-out-" })
      const cacheDir = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-crdcmd-cache-" })

      const failure = yield* _withCliPathsEnv(
        { chartsDir, outDir, cacheDir },
        Effect.flip(crdExtractEffect(_emptyFlags))
      )

      expect(failure).toBeInstanceOf(MissingCrdFlags)
    }).pipe(Effect.scoped, Effect.provide(_testLayer)))

  it.effect("--all extracts every registered chart and writes one file per release", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const path = yield* Path
      const chartsDir = yield* _makeChartsDir()
      yield* _writeChartFile(
        chartsDir,
        "gadgets.ts",
        `
export const chart = {
  _konfigHelmRelease: true,
  id: "gadgets",
  repo: "https://charts.example.com/repo",
  chart: "gadgets-chart",
  version: "2.0.0"
}
`
      )
      const outDir = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-crdcmd-out-" })
      const cacheDir = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-crdcmd-cache-" })

      yield* _withCliPathsEnv(
        { chartsDir, outDir, cacheDir },
        crdExtractEffect({ release: Option.none(), all: true })
      )

      const widgets = yield* fs.readFileString(path.join(outDir, "widgets.ts"))
      const gadgets = yield* fs.readFileString(path.join(outDir, "gadgets.ts"))
      expect(widgets).toContain("WidgetsInput")
      expect(gadgets).toContain("WidgetsInput")
    }).pipe(Effect.scoped, Effect.provide(_testLayer)))

  it.effect("--all with an empty chart registry succeeds without writing any file", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const chartsDir = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-crdcmd-charts-empty-" })
      const outDir = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-crdcmd-out-" })
      const cacheDir = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-crdcmd-cache-" })

      yield* _withCliPathsEnv(
        { chartsDir, outDir, cacheDir },
        crdExtractEffect({ release: Option.none(), all: true })
      )

      const entries = yield* fs.readDirectory(outDir)
      expect(entries).toEqual([])
    }).pipe(Effect.scoped, Effect.provide(_testLayer)))
})

describe("crdVerifyEffect", () => {
  it.effect("succeeds with no drift when committed output matches a fresh extraction", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const chartsDir = yield* _makeChartsDir()
      const outDir = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-crdcmd-out-" })
      const cacheDir = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-crdcmd-cache-" })

      yield* _withCliPathsEnv(
        { chartsDir, outDir, cacheDir },
        crdExtractEffect({ release: Option.some("widgets"), all: false })
      )
      yield* _withCliPathsEnv({ chartsDir, outDir, cacheDir }, crdVerifyEffect)

      const entries = yield* fs.readDirectory(outDir)
      expect(entries).toContain("widgets.ts")
    }).pipe(Effect.scoped, Effect.provide(_testLayer)))

  it.effect("fails with CrdDrift when the committed file is stale", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const path = yield* Path
      const chartsDir = yield* _makeChartsDir()
      const outDir = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-crdcmd-out-" })
      const cacheDir = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-crdcmd-cache-" })

      yield* fs.writeFileString(
        path.join(outDir, "widgets.ts"),
        "// Generated by @konfig.ts/cli — do not edit by hand\n// stale\n"
      )

      const failure = yield* _withCliPathsEnv(
        { chartsDir, outDir, cacheDir },
        Effect.flip(crdVerifyEffect)
      )

      expect(failure).toBeInstanceOf(CrdDrift)
      if (failure instanceof CrdDrift) {
        expect(failure.drifted).toEqual(["widgets.ts"])
      }
    }).pipe(Effect.scoped, Effect.provide(_testLayer)))

  it.effect("succeeds trivially when the chart registry is empty", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const chartsDir = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-crdcmd-charts-empty-" })
      const outDir = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-crdcmd-out-" })
      const cacheDir = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-crdcmd-cache-" })

      yield* _withCliPathsEnv({ chartsDir, outDir, cacheDir }, crdVerifyEffect)
    }).pipe(Effect.scoped, Effect.provide(_testLayer)))
})

describe("tagged errors", () => {
  it("ReleaseNotFound carries the offending release id", () => {
    const err = new ReleaseNotFound({ releaseId: "foo" })
    expect(err._tag).toBe("ReleaseNotFound")
    expect(err.releaseId).toBe("foo")
  })

  it("CrdDrift carries the drifted file list", () => {
    const err = new CrdDrift({ drifted: ["a.ts", "b.ts"] })
    expect(err._tag).toBe("CrdDrift")
    expect(err.drifted).toEqual(["a.ts", "b.ts"])
  })

  it("MissingCrdFlags is a bare tagged error", () => {
    const err = new MissingCrdFlags()
    expect(err._tag).toBe("MissingCrdFlags")
  })
})

/**
 * Sanity check that error encoding actually surfaces the tag over the
 * wire — guards against a future refactor silently widening the error
 * channel without updating command-level handling.
 */
describe("crdExtractEffect failure encoding", () => {
  it.effect("encodes ReleaseNotFound with its tag intact through Exit", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const chartsDir = yield* _makeChartsDir()
      const outDir = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-crdcmd-out-" })
      const cacheDir = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-crdcmd-cache-" })

      const exit = yield* _withCliPathsEnv(
        { chartsDir, outDir, cacheDir },
        Effect.exit(crdExtractEffect({ release: Option.some("nope"), all: false }))
      )
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const text = yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(exit.cause)
        expect(text).toContain("ReleaseNotFound")
      }
    }).pipe(Effect.scoped, Effect.provide(_testLayer)))
})
