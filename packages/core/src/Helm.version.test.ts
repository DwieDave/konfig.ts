import { NodeServices } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { Cause, ConfigProvider, Effect, Exit, Layer, Sink, Stream } from "effect"
import { FileSystem } from "effect/FileSystem"
import type { Command } from "effect/unstable/process/ChildProcess"
import {
  type ChildProcessHandle,
  ChildProcessSpawner,
  ExitCode,
  make as makeSpawner,
  makeHandle,
  ProcessId
} from "effect/unstable/process/ChildProcessSpawner"
import * as Helm from "./Helm"
import { RenderContext } from "./RenderContext"

interface FakeProc {
  readonly stdout?: string
  readonly stderr?: string
  readonly exitCode?: number
}

const _bytes = (s: string): Stream.Stream<Uint8Array> => Stream.make(new TextEncoder().encode(s))

const _handle = (proc: FakeProc): ChildProcessHandle =>
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

const _spawnerFor = (proc: FakeProc): Layer.Layer<ChildProcessSpawner> =>
  Layer.succeed(ChildProcessSpawner, makeSpawner((_command: Command) => Effect.succeed(_handle(proc))))

const _release = (minVersion: string) =>
  Helm.release({
    repo: "https://example.com/charts",
    chart: "fixture",
    version: "1.0.0",
    digest: "sha256:deadbeef",
    values: {},
    minVersion
  })

// The mock ChildProcessSpawner is provided *innermost* so it satisfies the
// version preflight's ChildProcessSpawner before NodeServices' real one is
// reached; NodeServices then supplies FileSystem/Path for the type. The
// preflight short-circuits before any filesystem work, so those are unused.
const _run = (minVersion: string, proc: FakeProc) =>
  _release(minVersion)
    .render(RenderContext.make("test"))
    .pipe(Effect.provide(Layer.mergeAll(NodeServices.layer, _spawnerFor(proc))), Effect.scoped, Effect.exit)

describe("Helm.release helm-version preflight", () => {
  it.effect("fails HelmVersionTooLow when the installed helm is older than minVersion", () =>
    Effect.gen(function*() {
      const exit = yield* _run("3.16.0", { stdout: "v3.10.0\n", exitCode: 0 })
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const pretty = Cause.pretty(exit.cause)
        expect(pretty).toContain("HelmVersionTooLow")
        expect(pretty).toContain("3.10.0")
      }
    }))

  it.effect("fails HelmVersionTooLow ('not found') when helm is absent (non-zero exit)", () =>
    Effect.gen(function*() {
      const exit = yield* _run("3.16.0", { stdout: "", stderr: "command not found", exitCode: 127 })
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const pretty = Cause.pretty(exit.cause)
        expect(pretty).toContain("HelmVersionTooLow")
        expect(pretty).toContain("not found")
      }
    }))

  // Proves the two config sources `Helm.release` honors — a ConfigProvider
  // for `cacheDir` (KONFIG_HELM_CACHE) and an explicit `minVersion` field —
  // are both respected together: a too-old helm fails the preflight before
  // the ConfigProvider-resolved cacheDir is ever touched.
  it.effect(
    "uses the ConfigProvider-resolved cacheDir and the caller's minVersion together",
    () =>
      Effect.gen(function*() {
        const fs = yield* FileSystem
        const cacheDir = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-helm-combined-" })
        const configProvider = ConfigProvider.fromUnknown({ KONFIG_HELM_CACHE: cacheDir })

        const exit = yield* _release("999.0.0")
          .render(RenderContext.make("test"))
          .pipe(
            Effect.provide(Layer.mergeAll(NodeServices.layer, _spawnerFor({ stdout: "v3.10.0\n", exitCode: 0 }))),
            Effect.provideService(ConfigProvider.ConfigProvider, configProvider),
            Effect.scoped,
            Effect.exit
          )

        expect(Exit.isFailure(exit)).toBe(true)
        if (Exit.isFailure(exit)) {
          expect(Cause.pretty(exit.cause)).toContain("HelmVersionTooLow")
        }
        // The preflight failed before any pull, so the resolved cacheDir was
        // created (Helm.ts creates it up front) but never populated.
        const files = yield* fs.readDirectory(cacheDir)
        expect(files).toEqual([])
      }).pipe(Effect.provide(NodeServices.layer))
  )
})
