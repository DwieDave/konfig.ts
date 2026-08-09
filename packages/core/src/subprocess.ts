import { Data, Effect, Stream } from "effect"
import type { PlatformError } from "effect/PlatformError"
import { ChildProcess, ChildProcessSpawner } from "./_unstable"

// -1 marks a spawn that never produced a real exit code, distinct from any OS exit code.
const SPAWN_FAILED_EXIT = -1

// Bounds stderr tail retained on ProcessError so a runaway log can't pin memory.
const STDERR_TAIL_LIMIT = 2048

const _tail = (text: string): string =>
  text.length > STDERR_TAIL_LIMIT ? text.slice(text.length - STDERR_TAIL_LIMIT) : text

const _commandLabel = (command: ChildProcess.Command): string =>
  ChildProcess.isStandardCommand(command)
    ? [command.command, ...command.args].join(" ")
    : "<pipeline>"

// `command` must never be interpolated with secret material by callers.
export class ProcessError extends Data.TaggedError("ProcessError")<{
  readonly command: string
  readonly exitCode: number
  readonly stderrTail: string
}> {
  get message(): string {
    const tail = this.stderrTail.trim()
    const suffix = tail.length > 0 ? `: ${tail}` : ""
    return `command \`${this.command}\` failed (exit ${this.exitCode})${suffix}`
  }
}

export const processDetail = (cause: unknown): string => {
  if (!(cause instanceof ProcessError)) return ""
  const tail = cause.stderrTail.trim()
  return tail.length > 0 ? ` (exit ${cause.exitCode}): ${tail}` : ` (exit ${cause.exitCode})`
}

interface _CollectedProcess {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

const _collect = (
  stream: Stream.Stream<Uint8Array, PlatformError>
): Effect.Effect<string, PlatformError> => Stream.mkString(Stream.decodeText(stream))

// Drains stdout/stderr concurrently with exitCode to avoid the classic pipe-buffer deadlock.
const _spawnCollect = (
  command: ChildProcess.Command
): Effect.Effect<_CollectedProcess, ProcessError, ChildProcessSpawner> =>
  Effect.scoped(
    Effect.gen(function*() {
      const spawner = yield* ChildProcessSpawner
      const handle = yield* spawner.spawn(command)
      const [exitCode, stdout, stderr] = yield* Effect.all(
        [handle.exitCode, _collect(handle.stdout), _collect(handle.stderr)],
        { concurrency: "unbounded" }
      )
      return { exitCode, stdout, stderr }
    })
  ).pipe(
    Effect.mapError(
      (cause) =>
        new ProcessError({
          command: _commandLabel(command),
          exitCode: SPAWN_FAILED_EXIT,
          stderrTail: _tail(String(cause))
        })
    )
  )

// oxlint-disable-next-line app/no-multiple-function-params
export const runProcessString = (
  command: ChildProcess.Command,
  options?: { readonly allowEmptyStdout?: boolean }
): Effect.Effect<string, ProcessError, ChildProcessSpawner> =>
  Effect.gen(function*() {
    const result = yield* _spawnCollect(command)
    if (result.exitCode !== 0) {
      return yield* new ProcessError({
        command: _commandLabel(command),
        exitCode: result.exitCode,
        stderrTail: _tail(result.stderr)
      })
    }
    if (options?.allowEmptyStdout !== true && result.stdout.trim().length === 0) {
      return yield* new ProcessError({
        command: _commandLabel(command),
        exitCode: result.exitCode,
        stderrTail: _tail(result.stderr)
      })
    }
    return result.stdout
  })

export const runProcessExit = (
  command: ChildProcess.Command
): Effect.Effect<void, ProcessError, ChildProcessSpawner> =>
  Effect.gen(function*() {
    const result = yield* _spawnCollect(command)
    if (result.exitCode !== 0) {
      return yield* new ProcessError({
        command: _commandLabel(command),
        exitCode: result.exitCode,
        stderrTail: _tail(result.stderr)
      })
    }
  })
