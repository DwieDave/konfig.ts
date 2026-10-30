import { NodeServices } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { Cause, ConfigProvider, Effect, Exit, Layer, Option } from "effect"
import { FileSystem } from "effect/FileSystem"
import type { Command } from "effect/process/ChildProcess"
import { ChildProcessSpawner, make as makeSpawner } from "effect/process/ChildProcessSpawner"
import * as Helm from "./Helm"
import { assertMinVersion } from "./helm/version"
import { RenderContext } from "./RenderContext"
import { HelmMinVersionInvalid, HelmRenderError, HelmVersionTooLow } from "./RenderError"
import { ProcessError } from "./subprocess"
import { fakeHandle, type FakeProc } from "./testing"

const _spawnerFor = (proc: FakeProc): Layer.Layer<ChildProcessSpawner> =>
  Layer.succeed(ChildProcessSpawner, makeSpawner((_command: Command) => Effect.succeed(fakeHandle(proc))))

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

  it.effect("fails HelmRenderError (version-check) carrying the ProcessError when helm cannot run", () =>
    Effect.gen(function*() {
      const exit = yield* _run("3.16.0", { stdout: "", stderr: "command not found", exitCode: 127 })
      expect(Exit.isFailure(exit)).toBe(true)

      if (Exit.isFailure(exit)) {
        const err = Option.getOrUndefined(Cause.findErrorOption(exit.cause))
        expect(err).toBeInstanceOf(HelmRenderError)

        if (err instanceof HelmRenderError) {
          expect(err.phase).toBe("version-check")
          expect(err.cause).toBeInstanceOf(ProcessError)
          expect(err.message).toContain("failed during version-check")
          expect(err.message).toContain("exit 127")
          expect(err.message).toContain("command not found")
        }

        expect(Cause.pretty(exit.cause)).not.toContain("HelmVersionTooLow")
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

const _errorOf = <E>(exit: Exit.Exit<unknown, E>): E | undefined =>
  Exit.isFailure(exit) ? Option.getOrUndefined(Cause.findErrorOption(exit.cause)) : undefined

describe("Helm.release minVersion semantics", () => {
  it.effect("accepts major.minor as major.minor.0", () =>
    Effect.gen(function*() {
      const exit = yield* _run("3.16", { stdout: "v3.10.0\n" })
      expect(_errorOf(exit)).toBeInstanceOf(HelmVersionTooLow)
    }))

  it.effect("fails with a typed error for an unparseable minVersion", () =>
    Effect.gen(function*() {
      const exit = yield* _run("latest", { stdout: "v3.99.0\n" })
      expect(_errorOf(exit)).toBeInstanceOf(HelmMinVersionInvalid)
    }))

  it.effect("a prerelease does not satisfy the matching release floor", () =>
    Effect.gen(function*() {
      const exit = yield* _run("3.16.0", { stdout: "v3.16.0-rc.1+gabc\n" })
      expect(_errorOf(exit)).toBeInstanceOf(HelmVersionTooLow)
    }))

  it.effect("retries the version probe after a failed probe instead of caching the failure", () =>
    Effect.gen(function*() {
      let calls = 0

      const spawner = Layer.succeed(
        ChildProcessSpawner,
        makeSpawner((_command: Command) => {
          calls += 1

          return Effect.succeed(fakeHandle(calls === 1 ? { stderr: "boom", exitCode: 1 } : { stdout: "v3.10.0\n" }))
        })
      )

      const run = _release("3.16.0")
        .render(RenderContext.make("test"))
        .pipe(Effect.provide(Layer.mergeAll(NodeServices.layer, spawner)), Effect.scoped, Effect.exit)

      expect(_errorOf(yield* run)).toBeInstanceOf(HelmRenderError)
      expect(_errorOf(yield* run)).toBeInstanceOf(HelmVersionTooLow)
      expect(calls).toBe(2)
    }))
})

describe("Helm version probe memoization", () => {
  it.effect("spawns `helm version` once under concurrent assertMinVersion calls", () =>
    Effect.gen(function*() {
      const spawns = { count: 0 }

      const spawner = Layer.succeed(
        ChildProcessSpawner,
        makeSpawner((_command: Command) =>
          Effect.sync(() => {
            spawns.count += 1
          }).pipe(Effect.andThen(Effect.yieldNow), Effect.as(fakeHandle({ stdout: "v3.17.0\n" })))
        )
      )

      yield* Effect.all(Array.from({ length: 4 }, () => assertMinVersion("3.16.0")), { concurrency: "unbounded" })
        .pipe(Effect.provide(spawner))
      expect(spawns.count).toBe(1)
    }))

  it.effect("does not cache a failed probe", () =>
    Effect.gen(function*() {
      const spawns = { count: 0 }

      const spawner = Layer.succeed(
        ChildProcessSpawner,
        makeSpawner((_command: Command) =>
          Effect.sync(() => {
            spawns.count += 1

            return fakeHandle({ stdout: "", stderr: "boom", exitCode: 1 })
          })
        )
      )

      const probe = Effect.exit(assertMinVersion("3.16.0")).pipe(Effect.provide(spawner))
      yield* probe
      yield* probe
      expect(spawns.count).toBe(2)
    }))
})
