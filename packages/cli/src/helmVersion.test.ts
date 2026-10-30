import { describe as effectDescribe, it as effectIt } from "@effect/vitest"
import { HelmVersionTooLow, ProcessError } from "@konfig.ts/core"
import { Cause, Effect, Exit, Layer, Option, Sink, Stream } from "effect"
import { systemError } from "effect/PlatformError"
import type { Command } from "effect/process/ChildProcess"
import {
  type ChildProcessHandle,
  ChildProcessSpawner,
  ExitCode,
  make as makeSpawner,
  makeHandle,
  ProcessId
} from "effect/process/ChildProcessSpawner"
import fc from "fast-check"
import semver from "semver"
import { describe, expect, it } from "vitest"
import { _normalizeMinVersion, _parseHelmVersion, assertHelmVersion, HelmMinVersionInvalid } from "./helmVersion"

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

describe("_normalizeMinVersion", () => {
  it("pads major.minor to major.minor.0", () => {
    expect(_normalizeMinVersion("3.12")).toBe("3.12.0")
    expect(_normalizeMinVersion("v3.12")).toBe("3.12.0")
  })

  it("keeps full versions and rejects junk", () => {
    expect(_normalizeMinVersion("3.12.1")).toBe("3.12.1")
    expect(_normalizeMinVersion("three")).toBe(null)
    expect(_normalizeMinVersion("")).toBe(null)
  })

  it("property: major.minor always normalizes to a valid semver that equals major.minor.0", () => {
    fc.assert(
      fc.property(fc.nat(50), fc.nat(50), (major, minor) => {
        const out = _normalizeMinVersion(`${major}.${minor}`)
        expect(out).toBe(`${major}.${minor}.0`)
        expect(semver.valid(out)).toBe(out)
      })
    )
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

  effectIt.effect(
    "passes the ProcessError through (not HelmVersionTooLow) when helm cannot be spawned",
    () =>
      Effect.gen(function*() {
        const exit = yield* Effect.exit(
          assertHelmVersion("3.16.0").pipe(Effect.provide(_spawnerFailing()))
        )
        expect(Exit.isFailure(exit)).toBe(true)
        if (Exit.isFailure(exit)) {
          expect(_findHelmVersionTooLow(exit.cause)).toBeUndefined()
          const err = Option.getOrUndefined(Cause.findErrorOption(exit.cause))
          expect(err).toBeInstanceOf(ProcessError)
          expect((err as ProcessError).message).toContain("helm version --short")
        }
      })
  )

  effectIt.effect(
    "passes the ProcessError through with exit code and stderr when helm exits non-zero",
    () =>
      Effect.gen(function*() {
        const exit = yield* Effect.exit(
          assertHelmVersion("3.16.0").pipe(
            Effect.provide(_spawnerFor({ stdout: "", stderr: "unknown flag", exitCode: 1 }))
          )
        )
        expect(Exit.isFailure(exit)).toBe(true)
        if (Exit.isFailure(exit)) {
          expect(_findHelmVersionTooLow(exit.cause)).toBeUndefined()
          const err = Option.getOrUndefined(Cause.findErrorOption(exit.cause))
          expect(err).toBeInstanceOf(ProcessError)
          expect((err as ProcessError).exitCode).toBe(1)
          expect((err as ProcessError).message).toContain("unknown flag")
        }
      })
  )

  effectIt.effect("fails with a typed HelmMinVersionInvalid for a non-semver minVersion", () =>
    Effect.gen(function*() {
      const exit = yield* Effect.exit(
        assertHelmVersion("banana").pipe(Effect.provide(_spawnerFor({ stdout: "v3.16.0\n" })))
      )
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        expect(Option.getOrUndefined(Cause.findErrorOption(exit.cause))).toBeInstanceOf(HelmMinVersionInvalid)
      }
    }))

  effectIt.effect(
    "accepts a major.minor minVersion",
    () => assertHelmVersion("3.12").pipe(Effect.provide(_spawnerFor({ stdout: "v3.16.0\n" })))
  )
})
