import { it } from "@effect/vitest"
import { Effect, Layer, Redacted } from "effect"
import { ChildProcess } from "effect/process"
import type { Command } from "effect/process/ChildProcess"
import { ChildProcessSpawner, make as makeSpawner } from "effect/process/ChildProcessSpawner"
import * as fc from "fast-check"
import { expect } from "vitest"
import { type ProcessFailure, runProcessExit } from "./subprocess"
import { fakeHandle } from "./testing"

const _failing = (stderr: string): Layer.Layer<ChildProcessSpawner> =>
  Layer.succeed(
    ChildProcessSpawner,
    makeSpawner((_command: Command) => Effect.succeed(fakeHandle({ exitCode: 1, stderr })))
  )

const _flipped = (input: { readonly command: Command; readonly stderr: string }): ProcessFailure =>
  Effect.runSync(runProcessExit({ command: input.command }).pipe(Effect.provide(_failing(input.stderr)), Effect.flip))

it("never leaks Redacted args into the ProcessError command label", () => {
  const arbSecret = fc.stringMatching(/^[A-Z0-9]{12,24}$/)
  fc.assert(
    fc.property(fc.array(arbSecret, { minLength: 1, maxLength: 4 }), (secrets) => {
      const command = ChildProcess.make("tool", ["--flag", ...secrets.map((s) => Redacted.make(s))])
      const label = _flipped({ command, stderr: "boom" }).command
      expect(secrets.some((s) => label.includes(s))).toBe(false)
      expect(label.split("<redacted>").length - 1).toBe(secrets.length)
    })
  )
})

it("keeps the stderr tail bounded and a suffix of the full stderr", () => {
  fc.assert(
    fc.property(fc.string({ maxLength: 6000 }), (stderr) => {
      const tail = _flipped({ command: ChildProcess.make("tool", []), stderr }).stderrTail
      expect(tail.length).toBeLessThanOrEqual(2048)
      expect(`${stderr.split(/\r\n|\n|\r/).join("\n")}\n`.endsWith(tail)).toBe(true)
    })
  )
})
