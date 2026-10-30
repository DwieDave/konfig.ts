import { it } from "@effect/vitest"
import { Duration, Effect, Fiber, Ref } from "effect"
import { ChildProcess } from "effect/process"
import { TestClock } from "effect/testing"
import { describe, expect } from "vitest"
import {
  ProcessError,
  ProcessInvocationError,
  ProcessTimeout,
  runProcessCollect,
  runProcessWithStdin
} from "./subprocess"
import { stdinAsString, stubSpawner } from "./testing"

const _cmd = ChildProcess.make("sops", ["--decrypt"])
const _bigStderr = `${"a".repeat(5000)}END`

describe("runProcessCollect", () => {
  it.effect("returns exit code, stdout and stderr without failing on non-zero", () =>
    Effect.gen(function*() {
      const result = yield* runProcessCollect({ command: _cmd }).pipe(
        Effect.provide(stubSpawner({ respond: () => ({ exitCode: 3, stdout: "out", stderr: "bad\n" }) }))
      )

      expect(result).toEqual({ exitCode: 3, stdout: "out", stderr: "bad\n" })
    }))

  it.effect("returns only the bounded stderr tail for large stderr", () =>
    Effect.gen(function*() {
      const result = yield* runProcessCollect({ command: _cmd }).pipe(
        Effect.provide(stubSpawner({ respond: () => ({ stderr: _bigStderr }) }))
      )

      expect(result.stderr.length).toBeLessThanOrEqual(2048)
      expect(result.stderr.trimEnd().endsWith("END")).toBe(true)
    }))

  it.effect("closes stdin on the spawned command", () =>
    Effect.gen(function*() {
      const seen = yield* Ref.make<ReadonlyArray<unknown>>([])

      yield* runProcessCollect({ command: _cmd }).pipe(
        Effect.provide(stubSpawner({
          respond: () => ({}),
          sink: (command) => Ref.update(seen, (all) => [...all, command.options.stdin])
        }))
      )

      expect(yield* Ref.get(seen)).toEqual(["ignore"])
    }))

  it.effect("fails with ProcessTimeout when the process outlives the timeout", () =>
    Effect.gen(function*() {
      const fiber = yield* runProcessCollect({ command: _cmd, timeout: Duration.seconds(5) }).pipe(
        Effect.provide(stubSpawner({ respond: () => ({ hang: true }) })),
        Effect.flip,
        Effect.forkChild
      )

      yield* TestClock.adjust(Duration.seconds(6))

      const error = yield* Fiber.join(fiber)

      expect(error).toBeInstanceOf(ProcessTimeout)
    }))
})

describe("runProcessWithStdin", () => {
  it.effect("feeds the encoded stdin to the process", () =>
    Effect.gen(function*() {
      const seen = yield* Ref.make<ReadonlyArray<string>>([])

      const out = yield* runProcessWithStdin({ command: _cmd, stdin: "secret: 1" }).pipe(
        Effect.provide(stubSpawner({
          respond: () => ({ stdout: "ok" }),
          sink: (command) =>
            stdinAsString(command).pipe(Effect.flatMap((text) => Ref.update(seen, (all) => [...all, text])))
        }))
      )

      expect(out).toBe("ok")
      expect(yield* Ref.get(seen)).toEqual(["secret: 1"])
    }))

  it.effect("wraps failures with the command label and exit detail", () =>
    Effect.gen(function*() {
      const error = yield* runProcessWithStdin({ command: _cmd, stdin: "" }).pipe(
        Effect.provide(stubSpawner({ respond: () => ({ exitCode: 1, stderr: "nope" }) })),
        Effect.flip
      )

      expect(error).toBeInstanceOf(ProcessInvocationError)
      expect(error.label).toBe("sops --decrypt")
      expect(error.message).toBe("sops --decrypt failed (exit 1): nope")
      expect(error.cause).toBeInstanceOf(ProcessError)
    }))

  it.effect("uses a custom label", () =>
    Effect.gen(function*() {
      const error = yield* runProcessWithStdin({ command: _cmd, stdin: "", label: "decrypt secrets" }).pipe(
        Effect.provide(stubSpawner({ respond: () => ({ exitCode: 2, stderr: "bad" }) })),
        Effect.flip
      )

      expect(error.message).toBe("decrypt secrets failed (exit 2): bad")
    }))

  it.effect("bounds ProcessError stderr to the tail", () =>
    Effect.gen(function*() {
      const error = yield* runProcessWithStdin({ command: _cmd, stdin: "" }).pipe(
        Effect.provide(stubSpawner({ respond: () => ({ exitCode: 1, stderr: _bigStderr }) })),
        Effect.flip
      )

      expect(error.cause).toBeInstanceOf(ProcessError)
      expect(error.cause instanceof ProcessError && error.cause.stderrTail.length).toBeLessThanOrEqual(2048)
    }))

  it.effect("applies a default timeout so a prompt cannot hang forever", () =>
    Effect.gen(function*() {
      const fiber = yield* runProcessWithStdin({ command: _cmd, stdin: "" }).pipe(
        Effect.provide(stubSpawner({ respond: () => ({ hang: true }) })),
        Effect.flip,
        Effect.forkChild
      )

      yield* TestClock.adjust(Duration.minutes(3))

      const error = yield* Fiber.join(fiber)

      expect(error.cause).toBeInstanceOf(ProcessTimeout)
    }))
})
