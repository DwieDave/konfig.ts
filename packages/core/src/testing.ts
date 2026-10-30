import { Effect, Layer, Redacted, Sink, Stream } from "effect"
import { isStandardCommand, type StandardCommand } from "effect/process/ChildProcess"
import {
  type ChildProcessHandle,
  ChildProcessSpawner,
  ExitCode,
  make as makeSpawner,
  makeHandle,
  ProcessId
} from "effect/process/ChildProcessSpawner"
import { unsafeCoerce } from "./_cast"

export interface FakeProc {
  readonly stdout?: string
  readonly stderr?: string
  readonly exitCode?: number
  readonly hang?: boolean
}

const _bytes = (s: string): Stream.Stream<Uint8Array> => Stream.make(new TextEncoder().encode(s))

export const plainArgs = (command: StandardCommand): ReadonlyArray<string> =>
  command.args.map((arg) => (Redacted.isRedacted(arg) ? Redacted.value(arg) : arg))

export const fakeHandle = (proc: FakeProc): ChildProcessHandle =>
  makeHandle(
    unsafeCoerce<Parameters<typeof makeHandle>[0]>({
      value: {
        pid: ProcessId(1),
        exitCode: proc.hang === true ? Effect.never : Effect.succeed(ExitCode(proc.exitCode ?? 0)),
        isRunning: Effect.succeed(false),
        kill: () => Effect.void,
        stdin: Sink.drain,
        stdout: _bytes(proc.stdout ?? ""),
        stderr: _bytes(proc.stderr ?? ""),
        all: _bytes((proc.stdout ?? "") + (proc.stderr ?? "")),
        getInputFd: () => Sink.drain,
        getOutputFd: () => Stream.empty,
        unref: Effect.succeed(Effect.void)
      },
      reason: "the fake supplies every handle member the spawner contract reads; the parameter type only adds the brand"
    })
  )

export const stdinAsString = (command: StandardCommand): Effect.Effect<string> =>
  Stream.isStream(command.options.stdin)
    ? Stream.decodeText(command.options.stdin).pipe(Stream.mkString, Effect.orDie)
    : Effect.succeed("")

export const stubSpawner = (input: {
  readonly respond: (command: StandardCommand) => FakeProc
  readonly sink?: (command: StandardCommand) => Effect.Effect<void>
}): Layer.Layer<ChildProcessSpawner> =>
  Layer.succeed(
    ChildProcessSpawner,
    makeSpawner((command) =>
      isStandardCommand(command)
        ? (input.sink?.(command) ?? Effect.void).pipe(Effect.as(fakeHandle(input.respond(command))))
        : Effect.succeed(fakeHandle({ exitCode: 1, stderr: "pipelines unsupported" }))
    )
  )
