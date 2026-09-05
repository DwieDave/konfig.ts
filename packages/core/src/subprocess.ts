import { Data, Duration, Effect, Stream } from "effect"
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
  // Set when the process exited 0 but the caller required stdout and got none.
  readonly emptyStdout?: boolean
}> {
  get message(): string {
    const tail = this.stderrTail.trim()
    const suffix = tail.length > 0 ? `: ${tail}` : ""
    return this.emptyStdout === true
      ? `command \`${this.command}\` exited ${this.exitCode} but produced no output on stdout${suffix}`
      : `command \`${this.command}\` failed (exit ${this.exitCode})${suffix}`
  }
}

// Raised when a subprocess exceeds the caller's `timeout`. The process is killed
// (its scope closes) before this surfaces, so nothing keeps running behind it.
export class ProcessTimeout extends Data.TaggedError("ProcessTimeout")<{
  readonly command: string
  readonly elapsed: Duration.Duration
  readonly stderrTail: string
}> {
  get message(): string {
    const tail = this.stderrTail.trim()
    const suffix = tail.length > 0 ? `; last stderr: ${tail}` : ""
    return `command \`${this.command}\` timed out after ${Duration.format(this.elapsed)}` +
      ` — it never exited on its own; if it was waiting for input (e.g. registry credentials)` +
      ` run it once by hand to log in, or raise the timeout${suffix}`
  }
}

export type ProcessFailure = ProcessError | ProcessTimeout

export const processDetail = (cause: unknown): string => {
  if (cause instanceof ProcessTimeout) return ` (timed out after ${Duration.format(cause.elapsed)})`
  if (!(cause instanceof ProcessError)) return ""
  const tail = cause.stderrTail.trim()
  const head = cause.emptyStdout === true ? ` (exit ${cause.exitCode}, empty stdout)` : ` (exit ${cause.exitCode})`
  return tail.length > 0 ? `${head}: ${tail}` : head
}

export interface ProcessOptions {
  // Fail with ProcessTimeout once the process has run this long. Unset = wait forever.
  readonly timeout?: Duration.Input
}

interface _CollectedProcess {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

const _collect = (
  stream: Stream.Stream<Uint8Array, PlatformError>
): Effect.Effect<string, PlatformError> => Stream.mkString(Stream.decodeText(stream))

// Streams stderr line by line to the debug log as it arrives (so a slow `helm pull`
// is visible under --log-level debug) while still accumulating the tail for errors.
const _collectStderr = (
  stream: Stream.Stream<Uint8Array, PlatformError>,
  tailRef: { current: string }
): Effect.Effect<string, PlatformError> =>
  Stream.decodeText(stream).pipe(
    Stream.splitLines,
    Stream.tap((line) => Effect.logDebug(line)),
    // splitLines strips the terminators; put them back so the collected
    // stderr (and the ProcessError tail built from it) keeps its line breaks.
    Stream.map((line) => `${line}\n`),
    Stream.tap((line) =>
      Effect.sync(() => {
        tailRef.current = _tail(`${tailRef.current}${line}`)
      })
    ),
    Stream.mkString
  )

// Subprocesses never get an interactive stdin: a pipe nobody writes to (the effect
// default) never sees EOF, so a tool that prompts — `helm pull` asking for registry
// credentials — blocks forever. Callers that feed stdin (sops, kubeseal) set it explicitly.
const _withClosedStdin = (command: ChildProcess.Command): ChildProcess.Command =>
  ChildProcess.isStandardCommand(command) && command.options.stdin === undefined
    ? ChildProcess.make(command.command, [...command.args], { ...command.options, stdin: "ignore" })
    : command

// Drains stdout/stderr concurrently with exitCode to avoid the classic pipe-buffer deadlock.
const _spawnCollect = (
  command: ChildProcess.Command,
  options: ProcessOptions | undefined
): Effect.Effect<_CollectedProcess, ProcessFailure, ChildProcessSpawner> => {
  const label = _commandLabel(command)
  const stderrTail = { current: "" }
  const run = Effect.scoped(
    Effect.gen(function*() {
      const spawner = yield* ChildProcessSpawner
      const handle = yield* spawner.spawn(_withClosedStdin(command))
      const [exitCode, stdout, stderr] = yield* Effect.all(
        [handle.exitCode, _collect(handle.stdout), _collectStderr(handle.stderr, stderrTail)],
        { concurrency: "unbounded" }
      )
      return { exitCode, stdout, stderr }
    })
  ).pipe(
    Effect.mapError(
      (cause) =>
        new ProcessError({
          command: label,
          exitCode: SPAWN_FAILED_EXIT,
          stderrTail: _tail(String(cause))
        })
    )
  )
  const timeout = options?.timeout
  if (timeout === undefined) return run
  return run.pipe(
    Effect.timeoutOrElse({
      duration: timeout,
      orElse: () =>
        new ProcessTimeout({
          command: label,
          elapsed: Duration.fromInputUnsafe(timeout),
          stderrTail: stderrTail.current
        })
    })
  )
}

export interface RunProcessStringOptions extends ProcessOptions {
  readonly allowEmptyStdout?: boolean
}

// oxlint-disable-next-line app/no-multiple-function-params
export const runProcessString = (
  command: ChildProcess.Command,
  options?: RunProcessStringOptions
): Effect.Effect<string, ProcessFailure, ChildProcessSpawner> =>
  Effect.gen(function*() {
    const result = yield* _spawnCollect(command, options)
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
        stderrTail: _tail(result.stderr),
        emptyStdout: true
      })
    }
    return result.stdout
  })

// oxlint-disable-next-line app/no-multiple-function-params
export const runProcessExit = (
  command: ChildProcess.Command,
  options?: ProcessOptions
): Effect.Effect<void, ProcessFailure, ChildProcessSpawner> =>
  Effect.gen(function*() {
    const result = yield* _spawnCollect(command, options)
    if (result.exitCode !== 0) {
      return yield* new ProcessError({
        command: _commandLabel(command),
        exitCode: result.exitCode,
        stderrTail: _tail(result.stderr)
      })
    }
  })
