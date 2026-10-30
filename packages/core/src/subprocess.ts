import { Data, Duration, Effect, Redacted, Stream } from "effect"
import type { PlatformError } from "effect/PlatformError"
import { ChildProcess } from "effect/process"
import { ChildProcessSpawner } from "effect/process/ChildProcessSpawner"

// -1 marks a spawn that never produced a real exit code, distinct from any OS exit code.
const SPAWN_FAILED_EXIT = -1

// Bounds stderr tail retained on ProcessError so a runaway log can't pin memory.
const STDERR_TAIL_LIMIT = 2048

const _tail = (text: string): string =>
  text.length > STDERR_TAIL_LIMIT ? text.slice(text.length - STDERR_TAIL_LIMIT) : text

const _commandLabel = (command: ChildProcess.Command): string =>
  ChildProcess.isStandardCommand(command)
    ? [command.command, ...command.args.map((arg) => (Redacted.isRedacted(arg) ? "<redacted>" : arg))].join(" ")
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
  readonly stderrTail: string
}

const _collect = (
  stream: Stream.Stream<Uint8Array, PlatformError>
): Effect.Effect<string, PlatformError> => Stream.mkString(Stream.decodeText(stream))

const _appendTail = (input: { readonly tailRef: { current: string }; readonly line: string }): Effect.Effect<void> =>
  Effect.sync(() => {
    input.tailRef.current = _tail(`${input.tailRef.current}${input.line}\n`)
  })

// Streams stderr line by line to the debug log as it arrives (so a slow `helm pull`
// is visible under --log-level debug) while keeping only the bounded tail for errors.
const _drainStderr = (input: {
  readonly stream: Stream.Stream<Uint8Array, PlatformError>
  readonly tailRef: { current: string }
}): Effect.Effect<void, PlatformError> =>
  Stream.decodeText(input.stream).pipe(
    Stream.splitLines,
    Stream.runForEach((line) =>
      Effect.logDebug(line).pipe(Effect.andThen(_appendTail({ tailRef: input.tailRef, line })))
    )
  )

// Subprocesses never get an interactive stdin: a pipe nobody writes to (the effect
// default) never sees EOF, so a tool that prompts — `helm pull` asking for registry
// credentials — blocks forever. Callers that feed stdin (sops, kubeseal) set it explicitly.
const _withClosedStdin = (command: ChildProcess.Command): ChildProcess.Command =>
  ChildProcess.isStandardCommand(command) && command.options.stdin === undefined
    ? ChildProcess.make(command.command, [...command.args], { ...command.options, stdin: "ignore" })
    : command

const _spawnAndDrain = (input: {
  readonly command: ChildProcess.Command
  readonly stderrTail: { current: string }
}) =>
  Effect.scoped(
    Effect.gen(function*() {
      const spawner = yield* ChildProcessSpawner
      const handle = yield* spawner.spawn(_withClosedStdin(input.command))

      const [exitCode, stdout] = yield* Effect.all(
        [
          handle.exitCode,
          _collect(handle.stdout),
          _drainStderr({ stream: handle.stderr, tailRef: input.stderrTail })
        ],
        { concurrency: "unbounded" }
      )

      return { exitCode, stdout, stderrTail: input.stderrTail.current }
    })
  )

const _spawnFailure = (input: { readonly label: string; readonly cause: unknown }): ProcessError =>
  new ProcessError({
    command: input.label,
    exitCode: SPAWN_FAILED_EXIT,
    stderrTail: _tail(String(input.cause))
  })

const _withTimeout = <A, R>(input: {
  readonly run: Effect.Effect<A, ProcessFailure, R>
  readonly label: string
  readonly stderrTail: { current: string }
  readonly timeout: Duration.Input | undefined
}): Effect.Effect<A, ProcessFailure, R> => {
  const { label, run, stderrTail, timeout } = input

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

// Drains stdout/stderr concurrently with exitCode to avoid the classic pipe-buffer deadlock.
const _spawnCollect = (input: {
  readonly command: ChildProcess.Command
  readonly options: ProcessOptions | undefined
}): Effect.Effect<_CollectedProcess, ProcessFailure, ChildProcessSpawner> => {
  const label = _commandLabel(input.command)
  const stderrTail = { current: "" }

  const run = _spawnAndDrain({ command: input.command, stderrTail }).pipe(
    Effect.mapError((cause) => _spawnFailure({ label, cause }))
  )

  return _withTimeout({ run, label, stderrTail, timeout: input.options?.timeout })
}

export interface RunProcessStringOptions extends ProcessOptions {
  readonly allowEmptyStdout?: boolean
}

const _failOnNonZero = (input: {
  readonly command: ChildProcess.Command
  readonly result: _CollectedProcess
}): Effect.Effect<void, ProcessError> =>
  input.result.exitCode === 0
    ? Effect.void
    : Effect.fail(
      new ProcessError({
        command: _commandLabel(input.command),
        exitCode: input.result.exitCode,
        stderrTail: input.result.stderrTail
      })
    )

export const runProcessString = (input: {
  readonly command: ChildProcess.Command
  readonly options?: RunProcessStringOptions
}): Effect.Effect<string, ProcessFailure, ChildProcessSpawner> =>
  Effect.gen(function*() {
    const { command, options } = input
    const result = yield* _spawnCollect({ command, options })
    yield* _failOnNonZero({ command, result })

    if (options?.allowEmptyStdout !== true && result.stdout.trim().length === 0) {
      return yield* new ProcessError({
        command: _commandLabel(command),
        exitCode: result.exitCode,
        stderrTail: result.stderrTail,
        emptyStdout: true
      })
    }

    return result.stdout
  })

export const runProcessExit = (input: {
  readonly command: ChildProcess.Command
  readonly options?: ProcessOptions
}): Effect.Effect<void, ProcessFailure, ChildProcessSpawner> =>
  Effect.gen(function*() {
    const { command, options } = input
    const result = yield* _spawnCollect({ command, options })
    yield* _failOnNonZero({ command, result })
  })

// Unlike runProcessString this does not fail on a non-zero exit: the caller inspects exitCode.
export const runProcessCollect = (input: {
  readonly command: ChildProcess.Command
  readonly timeout?: Duration.Input
}): Effect.Effect<
  { readonly exitCode: number; readonly stdout: string; readonly stderr: string },
  ProcessFailure,
  ChildProcessSpawner
> =>
  _spawnCollect({ command: input.command, options: { timeout: input.timeout } }).pipe(
    Effect.map(({ exitCode, stderrTail, stdout }) => ({ exitCode, stdout, stderr: stderrTail }))
  )

export class ProcessInvocationError extends Data.TaggedError("ProcessInvocationError")<{
  readonly label: string
  readonly cause: unknown
}> {
  get message(): string {
    return `${this.label} failed${processDetail(this.cause)}`
  }
}

const DEFAULT_STDIN_TIMEOUT = Duration.minutes(2)

const _withStdin = (input: {
  readonly command: ChildProcess.StandardCommand
  readonly stdin: string
}): ChildProcess.Command =>
  ChildProcess.make(input.command.command, [...input.command.args], {
    ...input.command.options,
    stdin: Stream.succeed<Uint8Array>(new TextEncoder().encode(input.stdin))
  })

export const runProcessWithStdin = (input: {
  readonly command: ChildProcess.StandardCommand
  readonly stdin: string
  readonly label?: string
  readonly timeout?: Duration.Input
}): Effect.Effect<string, ProcessInvocationError, ChildProcessSpawner> =>
  runProcessString({
    command: _withStdin(input),
    options: { timeout: input.timeout ?? DEFAULT_STDIN_TIMEOUT }
  }).pipe(
    Effect.mapError((cause) =>
      new ProcessInvocationError({ label: input.label ?? _commandLabel(input.command), cause })
    )
  )
