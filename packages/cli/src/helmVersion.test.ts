import { HelmVersionTooLow } from "@konfig.ts/core"
import { describe as effectDescribe, it as effectIt } from "@effect/vitest"
import { Cause, Effect, Exit, Layer, Option, Sink, Stream } from "effect"
import { systemError } from "effect/PlatformError"
import type { Command } from "effect/unstable/process/ChildProcess"
import {
  type ChildProcessHandle,
  ChildProcessSpawner,
  ExitCode,
  make as makeSpawner,
  makeHandle,
  ProcessId
} from "effect/unstable/process/ChildProcessSpawner"
import semver from "semver"
import { describe, expect, it } from "vitest"
import { _parseHelmVersion, assertHelmVersion } from "./helmVersion"

describe("_parseHelmVersion", () => {
  it("parses a plain release version", () => {
    expect(_parseHelmVersion("v3.16.0")).toBe("3.16.0")
    expect(_parseHelmVersion("v3.16.0+g1234abc\n")).toBe("3.16.0+g1234abc")
  })

  it("preserves pre-release suffix (no truncation)", () => {
    expect(_parseHelmVersion("v3.16.0-rc.1")).toBe("3.16.0-rc.1")
    expect(_parseHelmVersion("v3.17.0-beta.2+g0000\n")).toBe("3.17.0-beta.2+g0000")
  })

  it("returns null for unparseable input", () => {
    expect(_parseHelmVersion("")).toBe(null)
    expect(_parseHelmVersion("helm: not found")).toBe(null)
  })

  it("semver.gte admits a pre-release that meets minVersion", () => {
    // gte compares two concrete versions, so pre-releases participate without
    // any option (includePrerelease only exists for range checks).
    expect(semver.gte("3.16.0-rc.1", "3.15.0")).toBe(true)
    expect(semver.gte("3.16.0-rc.1", "3.16.0")).toBe(false)
  })
})

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

const _spawnerFor = (proc: FakeProc): Layer.Layer<ChildProcessSpawner> =>
  Layer.succeed(ChildProcessSpawner, makeSpawner((_command: Command) => Effect.succeed(_handle(proc))))

const _spawnerFailing = (): Layer.Layer<ChildProcessSpawner> =>
  Layer.succeed(
    ChildProcessSpawner,
    makeSpawner((_command: Command) =>
      Effect.fail(
        systemError({ _tag: "NotFound", module: "Command", method: "spawn", pathOrDescriptor: "helm" })
      )
    )
  )

const _findHelmVersionTooLow = (cause: Cause.Cause<unknown>): HelmVersionTooLow | undefined => {
  const err = Option.getOrUndefined(Cause.findErrorOption(cause))
  return err instanceof HelmVersionTooLow ? err : undefined
}

effectDescribe("assertHelmVersion", () => {
  effectIt.effect("succeeds when installed helm version meets minVersion", () =>
    assertHelmVersion("3.16.0").pipe(
      Effect.provide(_spawnerFor({ stdout: "v3.16.0+g1234abc\n", exitCode: 0 }))
    ))

  effectIt.effect("succeeds when installed helm version exceeds minVersion", () =>
    assertHelmVersion("3.15.0").pipe(
      Effect.provide(_spawnerFor({ stdout: "v3.16.2\n", exitCode: 0 }))
    ))

  effectIt.effect("fails HelmVersionTooLow with found version when below minVersion", () =>
    Effect.gen(function*() {
      const exit = yield* Effect.exit(
        assertHelmVersion("3.16.0").pipe(
          Effect.provide(_spawnerFor({ stdout: "v3.10.0\n", exitCode: 0 }))
        )
      )
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const err = _findHelmVersionTooLow(exit.cause)
        expect(err).toBeInstanceOf(HelmVersionTooLow)
        expect(err?.required).toBe("3.16.0")
        expect(err?.found).toBe("3.10.0")
      }
    }))

  effectIt.effect("fails HelmVersionTooLow with raw stdout when unparseable", () =>
    Effect.gen(function*() {
      const exit = yield* Effect.exit(
        assertHelmVersion("3.16.0").pipe(
          Effect.provide(_spawnerFor({ stdout: "garbled output\n", exitCode: 0 }))
        )
      )
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const err = _findHelmVersionTooLow(exit.cause)
        expect(err?.found).toBe("garbled output")
      }
    }))

  effectIt.effect("fails HelmVersionTooLow with found \"not found\" when helm cannot be run", () =>
    Effect.gen(function*() {
      const exit = yield* Effect.exit(
        assertHelmVersion("3.16.0").pipe(Effect.provide(_spawnerFailing()))
      )
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const err = _findHelmVersionTooLow(exit.cause)
        expect(err).toBeInstanceOf(HelmVersionTooLow)
        expect(err?.found).toBe("not found")
      }
    }))

  effectIt.effect("fails HelmVersionTooLow when helm exits non-zero", () =>
    Effect.gen(function*() {
      const exit = yield* Effect.exit(
        assertHelmVersion("3.16.0").pipe(
          Effect.provide(_spawnerFor({ stdout: "", stderr: "unknown flag", exitCode: 1 }))
        )
      )
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const err = _findHelmVersionTooLow(exit.cause)
        expect(err).toBeInstanceOf(HelmVersionTooLow)
        expect(err?.found).toBe("not found")
      }
    }))
})
