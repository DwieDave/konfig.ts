import { NodeServices } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { Helm } from "@konfig.ts/core"
import { ConfigProvider, Effect, Exit, Layer, Sink, Stream } from "effect"
import { FileSystem } from "effect/FileSystem"
import { Path } from "effect/Path"
import { ChildProcess } from "effect/unstable/process"
import type { Command } from "effect/unstable/process/ChildProcess"
import {
  type ChildProcessHandle,
  ChildProcessSpawner,
  ExitCode,
  make as makeSpawner,
  makeHandle,
  ProcessId
} from "effect/unstable/process/ChildProcessSpawner"
import * as crypto from "node:crypto"
import { ChartRegistryEntryDecodeError } from "../chartRegistry"
import { _fetchOne, helmFetchEffect, MissingAllFlag } from "./helmFetch"

const _sha256Hex = (buf: Buffer): string => crypto.createHash("sha256").update(buf).digest("hex")

interface FakeProc {
  readonly stdout?: string
  readonly stderr?: string
  readonly exitCode?: number
}

const _bytes = (s: string): Stream.Stream<Uint8Array> => Stream.make(new TextEncoder().encode(s))

const _handle = (proc: FakeProc): ChildProcessHandle =>
  makeHandle(
    {
      pid: ProcessId(1),
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
 * Records every command argv the fake spawner is asked to run, so tests
 * can assert on the exact `helm pull` invocation `_fetchOne`/`helmFetchEffect`
 * plan without ever running the real binary. The "helm version --short"
 * preflight is answered separately so tests only see the `helm pull` calls.
 */
const _recordingSpawner = (
  proc: FakeProc,
  calls: Array<ReadonlyArray<string>>
): Layer.Layer<ChildProcessSpawner> =>
  Layer.succeed(
    ChildProcessSpawner,
    makeSpawner((command: Command) => {
      if (ChildProcess.isStandardCommand(command)) {
        if (command.args.includes("version")) {
          return Effect.succeed(_handle({ stdout: "v3.99.0\n", exitCode: 0 }))
        }
        calls.push([command.command, ...command.args])
      }
      return Effect.succeed(_handle(proc))
    })
  )

/**
 * A `pull` here writes `tarball`'s bytes to `<destination>/<chart>-<version>.tgz`
 * (matching real `helm pull` output), so the digest-verification path in
 * `_fetchOne` has a real file to hash and rename.
 */
const _pullingSpawner = (tarball: Buffer): Layer.Layer<ChildProcessSpawner, never, FileSystem | Path> =>
  Layer.effect(
    ChildProcessSpawner,
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const path = yield* Path
      return makeSpawner(
        ((command: Command) =>
          Effect.gen(function*() {
            if (!ChildProcess.isStandardCommand(command)) return _handle({ exitCode: 0 })
            const args = command.args
            if (args.includes("version")) return _handle({ stdout: "v3.99.0\n", exitCode: 0 })
            if (args[0] === "pull") {
              const destIdx = args.indexOf("--destination")
              const dest = args[destIdx + 1] ?? ""
              const chart = args[3] ?? "chart"
              const version = args[args.indexOf("--version") + 1] ?? "0.0.0"
              yield* fs.writeFile(path.join(dest, `${chart}-${version}.tgz`), tarball)
              return _handle({ exitCode: 0 })
            }
            return _handle({ exitCode: 0 })
          })) as unknown as Parameters<typeof makeSpawner>[0]
      )
    })
  )

describe("_fetchOne", () => {
  it.effect("skips the helm pull subprocess when the tarball is already cached", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const path = yield* Path
      const cacheDir = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-helmfetch-" })
      yield* fs.writeFileString(path.join(cacheDir, "postgresql-16.0.0.tgz"), "cached-tarball")

      const calls: Array<ReadonlyArray<string>> = []
      yield* _fetchOne({ repo: "https://charts.bitnami.com/bitnami", chart: "postgresql", version: "16.0.0", cacheDir })
        .pipe(Effect.provide(_recordingSpawner({ exitCode: 0 }, calls)))

      expect(calls).toEqual([])
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("plans a helm pull with --repo/--version/--destination when not cached", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const cacheDir = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-helmfetch-" })

      const calls: Array<ReadonlyArray<string>> = []
      yield* _fetchOne({ repo: "https://charts.bitnami.com/bitnami", chart: "postgresql", version: "16.0.0", cacheDir })
        .pipe(Effect.provide(_recordingSpawner({ exitCode: 0 }, calls)))

      expect(calls).toEqual([
        [
          "helm",
          "pull",
          "--repo",
          "https://charts.bitnami.com/bitnami",
          "postgresql",
          "--version",
          "16.0.0",
          "--destination",
          cacheDir
        ]
      ])
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("creates the cache dir before checking for the cached tarball", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const path = yield* Path
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-helmfetch-" })
      const cacheDir = path.join(root, "nested", "cache")

      const calls: Array<ReadonlyArray<string>> = []
      yield* _fetchOne({ repo: "https://example.com/charts", chart: "redis", version: "1.0.0", cacheDir })
        .pipe(Effect.provide(_recordingSpawner({ exitCode: 0 }, calls)))

      const exists = yield* fs.exists(cacheDir)
      expect(exists).toBe(true)
      expect(calls.length).toBe(1)
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("with a digest, caches the pulled tarball under the digest-suffixed name", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const cacheDir = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-helmfetch-digest-" })

      const tarball = Buffer.from("fake-postgresql-tarball")
      const digest = `sha256:${_sha256Hex(tarball)}`

      yield* _fetchOne({
        repo: "https://charts.bitnami.com/bitnami",
        chart: "postgresql",
        version: "16.0.0",
        cacheDir,
        digest
      }).pipe(Effect.provide(_pullingSpawner(tarball)))

      const files = yield* fs.readDirectory(cacheDir)
      // No leftover plain-named file and no leftover pull scratch dir — only
      // the digest-suffixed name `Helm.release` also caches under.
      expect(files).toEqual([Helm.cacheFileName({ chart: "postgresql", version: "16.0.0", digest })])
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("with a digest, skips the pull when the digest-suffixed tarball is already cached", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const path = yield* Path
      const cacheDir = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-helmfetch-digest-cached-" })
      const digest = `sha256:${_sha256Hex(Buffer.from("already-cached"))}`
      yield* fs.writeFileString(
        path.join(cacheDir, Helm.cacheFileName({ chart: "postgresql", version: "16.0.0", digest })),
        "already-cached"
      )

      const calls: Array<ReadonlyArray<string>> = []
      yield* _fetchOne({
        repo: "https://charts.bitnami.com/bitnami",
        chart: "postgresql",
        version: "16.0.0",
        cacheDir,
        digest
      }).pipe(Effect.provide(_recordingSpawner({ exitCode: 0 }, calls)))

      expect(calls).toEqual([])
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("with a digest, fails and cleans up when the pulled tarball's digest doesn't match", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const cacheDir = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-helmfetch-digest-mismatch-" })

      const tarball = Buffer.from("real-tarball-bytes")
      const wrongDigest = `sha256:${_sha256Hex(Buffer.from("not-the-tarball"))}`

      const exit = yield* Effect.exit(
        _fetchOne({
          repo: "https://charts.bitnami.com/bitnami",
          chart: "postgresql",
          version: "16.0.0",
          cacheDir,
          digest: wrongDigest
        }).pipe(Effect.provide(_pullingSpawner(tarball)))
      )

      expect(Exit.isFailure(exit)).toBe(true)
      // The digest-suffixed slot was never populated with the wrong bytes.
      const files = yield* fs.readDirectory(cacheDir)
      expect(files).toEqual([])
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))
})

const _configFor = (opts: { readonly chartsDir: string; readonly cacheDir: string; readonly minVersion?: string }) =>
  ConfigProvider.layer(
    ConfigProvider.fromEnvRecord({
      KONFIG_HELM_CACHE: opts.cacheDir,
      KONFIG_CHARTS_DIR: opts.chartsDir,
      KONFIG_HELM_MIN_VERSION: opts.minVersion ?? "3.0.0",
      KONFIG_CRD_OUT_DIR: opts.cacheDir
    })
  )

const _chartFixture = `export const postgres = {
  _konfigHelmRelease: true as const,
  id: "postgres",
  repo: "https://charts.bitnami.com/bitnami",
  chart: "postgresql",
  version: "16.0.0",
  digest: ""
}
`

describe("helmFetchEffect", () => {
  it.effect("fails with MissingAllFlag and never spawns helm pull when --all is not set", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const chartsDir = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-charts-" })
      const cacheDir = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-cache-" })

      const calls: Array<ReadonlyArray<string>> = []
      const exit = yield* Effect.exit(
        helmFetchEffect({ all: false }).pipe(
          Effect.provide(Layer.merge(_recordingSpawner({ exitCode: 0 }, calls), _configFor({ chartsDir, cacheDir })))
        )
      )

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const err = yield* Effect.flip(Effect.failCause(exit.cause))
        expect(err).toBeInstanceOf(MissingAllFlag)
      }
      expect(calls).toEqual([])
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("fetches every registry chart into cacheDir when --all is set", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const path = yield* Path
      const chartsDir = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-charts-" })
      const cacheDir = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-cache-" })
      yield* fs.writeFileString(path.join(chartsDir, "postgres.ts"), _chartFixture)

      const calls: Array<ReadonlyArray<string>> = []
      yield* helmFetchEffect({ all: true }).pipe(
        Effect.provide(Layer.merge(_recordingSpawner({ exitCode: 0 }, calls), _configFor({ chartsDir, cacheDir })))
      )

      expect(calls).toEqual([
        [
          "helm",
          "pull",
          "--repo",
          "https://charts.bitnami.com/bitnami",
          "postgresql",
          "--version",
          "16.0.0",
          "--destination",
          cacheDir
        ]
      ])
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("skips a chart whose tarball is already cached but still runs the fetch loop", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const path = yield* Path
      const chartsDir = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-charts-" })
      const cacheDir = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-cache-" })
      yield* fs.writeFileString(path.join(chartsDir, "postgres.ts"), _chartFixture)
      yield* fs.writeFileString(path.join(cacheDir, "postgresql-16.0.0.tgz"), "cached")

      const calls: Array<ReadonlyArray<string>> = []
      yield* helmFetchEffect({ all: true }).pipe(
        Effect.provide(Layer.merge(_recordingSpawner({ exitCode: 0 }, calls), _configFor({ chartsDir, cacheDir })))
      )

      expect(calls).toEqual([])
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("propagates ChartRegistryEntryDecodeError for a malformed chart module", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const path = yield* Path
      const chartsDir = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-charts-" })
      const cacheDir = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-cache-" })
      yield* fs.writeFileString(
        path.join(chartsDir, "broken.ts"),
        `export const broken = { _konfigHelmRelease: true as const, repo: "not a url" }\n`
      )

      const calls: Array<ReadonlyArray<string>> = []
      const exit = yield* Effect.exit(
        helmFetchEffect({ all: true }).pipe(
          Effect.provide(Layer.merge(_recordingSpawner({ exitCode: 0 }, calls), _configFor({ chartsDir, cacheDir })))
        )
      )

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const err = yield* Effect.flip(Effect.failCause(exit.cause))
        expect(err).toBeInstanceOf(ChartRegistryEntryDecodeError)
      }
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("fails HelmVersionTooLow before touching the registry when helm is too old", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const chartsDir = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-charts-" })
      const cacheDir = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-cache-" })

      const spawner = Layer.succeed(
        ChildProcessSpawner,
        makeSpawner((_command: Command) => Effect.succeed(_handle({ stdout: "v1.0.0\n", exitCode: 0 })))
      )

      const exit = yield* Effect.exit(
        helmFetchEffect({ all: true }).pipe(
          Effect.provide(Layer.merge(spawner, _configFor({ chartsDir, cacheDir, minVersion: "3.16.0" })))
        )
      )

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const err = yield* Effect.flip(Effect.failCause(exit.cause))
        expect((err as { readonly _tag?: string })._tag).toBe("HelmVersionTooLow")
      }
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))
})
