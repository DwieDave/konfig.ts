import { it } from "@effect/vitest"
import { Cause, Effect, Exit, Fiber, Layer, Option, Schema, Sink, Stream } from "effect"
import { TestClock } from "effect/testing"
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
import { describe, expect } from "vitest"
import { ProcessError, ProcessTimeout, runProcessExit, runProcessString } from "./subprocess"

interface FakeProc {
  readonly stdout?: string
  readonly stderr?: string
  readonly exitCode?: number
  // When true the fake never exits — simulates helm blocked on a credential prompt.
  readonly hangs?: boolean
}

const _bytes = (s: string): Stream.Stream<Uint8Array> => Stream.make(new TextEncoder().encode(s))

const _handle = (proc: FakeProc): ChildProcessHandle =>
  makeHandle(
    {
      pid: ProcessId(4242),
      exitCode: proc.hangs === true ? Effect.never : Effect.succeed(ExitCode(proc.exitCode ?? 0)),
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

const _spawnerFor = (proc: FakeProc, seen?: Command[]): Layer.Layer<ChildProcessSpawner> =>
  Layer.succeed(
    ChildProcessSpawner,
    makeSpawner((command: Command) => {
      seen?.push(command)
      return Effect.succeed(_handle(proc))
    })
  )

const _cmd = ChildProcess.make("echo", ["hi"])

describe("stdin", () => {
  it.effect("spawns with stdin ignored when the caller set none", () =>
    Effect.gen(function*() {
      const seen: Command[] = []
      yield* runProcessExit(_cmd).pipe(Effect.provide(_spawnerFor({ exitCode: 0 }, seen)))
      const spawned = seen[0]
      expect(spawned !== undefined && ChildProcess.isStandardCommand(spawned)).toBe(true)
      if (spawned !== undefined && ChildProcess.isStandardCommand(spawned)) {
        expect(spawned.options.stdin).toBe("ignore")
        expect(spawned.args).toEqual(["hi"])
      }
    }))

  it.effect("keeps an explicitly provided stdin stream", () =>
    Effect.gen(function*() {
      const seen: Command[] = []
      const stdin = Stream.succeed(new TextEncoder().encode("secret"))
      const cmd = ChildProcess.make("cat", [], { stdin })
      const out = yield* runProcessString(cmd).pipe(Effect.provide(_spawnerFor({ stdout: "ok" }, seen)))
      expect(out).toBe("ok")
      const spawned = seen[0]
      if (spawned !== undefined && ChildProcess.isStandardCommand(spawned)) {
        expect(spawned.options.stdin).toBe(stdin)
      }
    }))
})

describe("timeout", () => {
  it.effect("fails with ProcessTimeout when the process never exits", () =>
    Effect.gen(function*() {
      const fiber = yield* Effect.forkChild(
        Effect.exit(
          runProcessExit(_cmd, { timeout: "5 seconds" }).pipe(
            Effect.provide(_spawnerFor({ hangs: true, stderr: "Username: " }))
          )
        )
      )
      yield* TestClock.adjust("6 seconds")
      const exit = yield* Fiber.join(fiber)
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const err = Option.getOrUndefined(Cause.findErrorOption(exit.cause))
        expect(err).toBeInstanceOf(ProcessTimeout)
        if (err instanceof ProcessTimeout) {
          expect(err.command).toBe("echo hi")
          expect(err.message).toContain("timed out after 5s")
          expect(err.message).toContain("Username:")
        }
      }
    }))

  it.effect("does not fire when the process exits in time", () =>
    Effect.gen(function*() {
      const out = yield* runProcessString(_cmd, { timeout: "5 seconds" }).pipe(
        Effect.provide(_spawnerFor({ stdout: "fast" }))
      )
      expect(out).toBe("fast")
    }))
})

describe("runProcessString", () => {
  it.effect("zero-exit with non-empty stdout returns stdout", () =>
    Effect.gen(function*() {
      const out = yield* runProcessString(_cmd).pipe(
        Effect.provide(_spawnerFor({ stdout: "hello\n", exitCode: 0 }))
      )
      expect(out).toBe("hello\n")
    }))

  it.effect("non-zero exit fails with ProcessError carrying the stderr tail", () =>
    Effect.gen(function*() {
      const exit = yield* Effect.exit(
        runProcessString(_cmd).pipe(
          Effect.provide(
            _spawnerFor({ stdout: "", stderr: "boom: bad flag\n", exitCode: 2 })
          )
        )
      )
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const err = exit.cause
        const text = yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(err)
        expect(text).toContain("ProcessError")
        expect(text).toContain("boom: bad flag")
      }
    }))

  it.effect("zero-exit with empty stdout fails when allowEmptyStdout is not set", () =>
    Effect.gen(function*() {
      const exit = yield* Effect.exit(
        runProcessString(_cmd).pipe(
          Effect.provide(_spawnerFor({ stdout: "   \n", exitCode: 0 }))
        )
      )
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const err = Option.getOrUndefined(Cause.findErrorOption(exit.cause))
        expect(err).toBeInstanceOf(ProcessError)
        if (err instanceof ProcessError) {
          expect(err.message).toContain("produced no output")
          expect(err.message).not.toContain("failed (exit 0)")
        }
      }
    }))

  it.effect("zero-exit with empty stdout returns \"\" when allowEmptyStdout is true", () =>
    Effect.gen(function*() {
      const out = yield* runProcessString(_cmd, { allowEmptyStdout: true }).pipe(
        Effect.provide(_spawnerFor({ stdout: "", exitCode: 0 }))
      )
      expect(out).toBe("")
    }))

  it.effect("non-zero exit fails even when allowEmptyStdout is true", () =>
    Effect.gen(function*() {
      const exit = yield* Effect.exit(
        runProcessString(_cmd, { allowEmptyStdout: true }).pipe(
          Effect.provide(_spawnerFor({ stdout: "partial", stderr: "nope", exitCode: 1 }))
        )
      )
      expect(Exit.isFailure(exit)).toBe(true)
    }))
})

describe("runProcessExit", () => {
  it.effect("zero exit succeeds", () => runProcessExit(_cmd).pipe(Effect.provide(_spawnerFor({ exitCode: 0 }))))

  it.effect("non-zero exit fails with ProcessError carrying the stderr tail", () =>
    Effect.gen(function*() {
      const exit = yield* Effect.exit(
        runProcessExit(_cmd).pipe(
          Effect.provide(_spawnerFor({ stderr: "pull failed", exitCode: 1 }))
        )
      )
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const text = yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(exit.cause)
        expect(text).toContain("pull failed")
      }
    }))
})

describe("ProcessError", () => {
  it("message includes command, exit code, and stderr tail", () => {
    const err = new ProcessError({ command: "helm template x", exitCode: 7, stderrTail: "boom" })
    expect(err._tag).toBe("ProcessError")
    expect(err.message).toContain("helm template x")
    expect(err.message).toContain("exit 7")
    expect(err.message).toContain("boom")
  })

  it.effect("bounds the stderr tail to roughly 2KB (last bytes retained)", () =>
    Effect.gen(function*() {
      const big = `${"x".repeat(5000)}TAILMARKER`
      const exit = yield* Effect.exit(
        runProcessExit(_cmd).pipe(
          Effect.provide(_spawnerFor({ stderr: big, exitCode: 1 }))
        )
      )
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const err = Option.getOrUndefined(Cause.findErrorOption(exit.cause))
        expect(err).toBeInstanceOf(ProcessError)
        if (err instanceof ProcessError) {
          expect(err.stderrTail.length).toBeLessThanOrEqual(2048)
          expect(err.stderrTail).toContain("TAILMARKER")
        }
      }
    }))
})
