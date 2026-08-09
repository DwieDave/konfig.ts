import { NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Effect, Exit, Layer, Schema, Sink, Stream } from "effect"
import { type Command } from "effect/unstable/process/ChildProcess"
import {
  ChildProcessSpawner,
  ExitCode,
  make as makeSpawner,
  makeHandle,
  ProcessId
} from "effect/unstable/process/ChildProcessSpawner"
import { describe, expect } from "vitest"
import { sopsEncryptStdin } from "./sops"

const coerce = <T>(value: unknown): T => value as T

// A spawner that would happily "succeed" if invoked — proves an invalid recipient never
// reaches argv/spawn because sopsEncryptStdin validates before spawning sops.
const _passthroughSpawner: Layer.Layer<ChildProcessSpawner> = Layer.succeed(
  ChildProcessSpawner,
  makeSpawner((_cmd: Command) =>
    Effect.succeed(
      makeHandle({
        pid: ProcessId(1),
        exitCode: Effect.succeed(ExitCode(0)),
        isRunning: Effect.succeed(false),
        kill: () => Effect.void,
        stdin: Sink.drain,
        stdout: Stream.make(new TextEncoder().encode("ok: yes\n")),
        stderr: Stream.empty,
        all: Stream.make(new TextEncoder().encode("ok: yes\n")),
        getInputFd: () => Sink.drain,
        getOutputFd: () => Stream.empty,
        unref: Effect.succeed(Effect.void)
      })
    )
  )
)

describe("sopsEncryptStdin validates recipients itself (public API, not just via backend.ts)", () => {
  it.effect("rejects an unvalidated age recipient containing a comma, without spawning sops", () =>
    Effect.gen(function*() {
      const exit = yield* Effect.exit(
        sopsEncryptStdin({
          plaintextYaml: "url: u\n",
          recipients: {
            // Cast bypasses the SopsRecipients type to simulate a caller who skipped decode.
            age: coerce<readonly string[]>([
              "age1stub00000000000000000000000000000000000000000000000000ends,age1injected00000000000000000000000000000000000000000leak"
            ])
          }
        }).pipe(Effect.provide(_passthroughSpawner))
      )
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const text = yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(exit.cause)
        expect(text).toContain("SopsRecipients")
        expect(text).toContain("BoundaryDecodeError")
      }
    }).pipe(Effect.provide(NodeServices.layer)))
})
