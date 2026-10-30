import { unsafeCoerce } from "@konfig.ts/core"
import { Effect, Redacted, Sink, Stream } from "effect"
import type { StandardCommand } from "effect/process/ChildProcess"
import { type ChildProcessHandle, ExitCode, makeHandle, ProcessId } from "effect/process/ChildProcessSpawner"

export interface FakeProc {
  readonly stdout?: string
  readonly stderr?: string
  readonly exitCode?: number
}

const _bytes = (s: string): Stream.Stream<Uint8Array> => Stream.make(new TextEncoder().encode(s))

export const plainArgs = (command: StandardCommand): ReadonlyArray<string> =>
  command.args.map((arg) => (Redacted.isRedacted(arg) ? Redacted.value(arg) : arg))

export const fakeHandle = (proc: FakeProc): ChildProcessHandle =>
  makeHandle(
    unsafeCoerce<Parameters<typeof makeHandle>[0]>(
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
      },
      "the fake supplies every handle member the spawner contract reads; the parameter type only adds the brand"
    )
  )
