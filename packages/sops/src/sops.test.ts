import { it } from "@effect/vitest"
import { BoundaryDecodeError } from "@konfig.ts/core"
import { plainArgs, stdinAsString, stubSpawner } from "@konfig.ts/core/testing"
import { Effect, Exit } from "effect"
import type { StandardCommand } from "effect/process/ChildProcess"
import * as fc from "fast-check"
import { describe, expect, it as plainIt } from "vitest"
import type { SopsRecipients } from "./schema"
import { _recipientArgs, _sopsArgs, sopsDecrypt, sopsEncryptStdin, SopsInvocationError } from "./sops"

const AGE = "age1stub00000000000000000000000000000000000000000000000000ends"

const _recording = (input: {
  readonly calls: StandardCommand[]
  readonly stdins?: string[]
  readonly respond: () => { readonly stdout?: string; readonly exitCode?: number }
}) =>
  stubSpawner({
    respond: input.respond,
    sink: (cmd) =>
      stdinAsString(cmd).pipe(
        Effect.map((stdin) => {
          input.calls.push(cmd)
          input.stdins?.push(stdin)
        })
      )
  })

const _agePool = fc.stringMatching(/^age1[0-9a-z]{58}$/)

const _recipients = fc.record({
  age: fc.option(fc.array(_agePool, { maxLength: 3 }), { nil: undefined })
}, { requiredKeys: [] }).map((r): SopsRecipients => r.age === undefined ? {} : { age: r.age })

describe("_recipientArgs properties", () => {
  plainIt("emits the --age flag iff the list is non-empty", () => {
    fc.assert(fc.property(_recipients, (recipients) => {
      const args = _recipientArgs(recipients)
      expect(args.includes("--age")).toBe((recipients.age?.length ?? 0) > 0)
    }))
  })

  plainIt("joins accepted recipients with commas only and no shell metacharacters", () => {
    fc.assert(fc.property(fc.array(_agePool, { minLength: 1, maxLength: 3 }), (age) => {
      const [, value] = _recipientArgs({ age })
      expect(value?.split(",")).toEqual(age)
      expect(value).not.toMatch(/[;&|$`\s'"\\<>]/)
    }))
  })
})

describe("sopsEncryptStdin recipient rejection property", () => {
  const _tainted = fc.tuple(_agePool, fc.constantFrom(",", ";", " ", "$", "`", "|"), fc.string({ minLength: 1 }))
    .map(([age, sep, tail]) => `${age}${sep}${tail}`)

  it.effect("rejects any recipient that is not a plain age key, without spawning sops", () =>
    Effect.promise(() =>
      fc.assert(fc.asyncProperty(_tainted, (bad) =>
        Effect.runPromise(
          Effect.gen(function*() {
            const calls: StandardCommand[] = []

            const exit = yield* Effect.exit(
              sopsEncryptStdin({ plaintextYaml: "a: b\n", recipients: { age: [bad] } }).pipe(
                Effect.provide(_recording({ calls, respond: () => ({ stdout: "ok: yes\n" }) }))
              )
            )

            expect(Exit.isFailure(exit)).toBe(true)
            expect(calls).toHaveLength(0)
          })
        )))
    ))
})

describe("_sopsArgs properties", () => {
  plainIt("always ends with stdin, pins the regex and ignores ambient config", () => {
    fc.assert(fc.property(_recipients, fc.option(fc.string(), { nil: undefined }), (recipients, regex) => {
      const args = _sopsArgs({ recipients, encryptedRegex: regex })
      expect(args.at(-1)).toBe("/dev/stdin")
      expect(args[args.indexOf("--config") + 1]).toBe("/dev/null")
      expect(args[args.indexOf("--encrypted-regex") + 1]).toBe(regex ?? "^(data|stringData)$")
    }))
  })
})

describe("sopsEncryptStdin validates recipients itself", () => {
  it.effect("rejects an unvalidated age recipient containing a comma with BoundaryDecodeError", () =>
    Effect.gen(function*() {
      const error = yield* Effect.flip(
        sopsEncryptStdin({
          plaintextYaml: "url: u\n",
          recipients: {
            age: [
              "age1stub00000000000000000000000000000000000000000000000000ends,age1injected00000000000000000000000000000000000000000leak"
            ]
          }
        }).pipe(Effect.provide(stubSpawner({ respond: () => ({ stdout: "ok: yes\n" }) })))
      )

      expect(error).toBeInstanceOf(BoundaryDecodeError)
      expect(error.message).toContain("SopsRecipients")
    }))
})

describe("sopsEncryptStdin", () => {
  it.effect("pipes the plaintext on stdin with the pinned encrypt argv and returns stdout", () =>
    Effect.gen(function*() {
      const calls: StandardCommand[] = []
      const stdins: string[] = []

      const out = yield* sopsEncryptStdin({ plaintextYaml: "url: u\n", recipients: { age: [AGE] } }).pipe(
        Effect.provide(_recording({ calls, stdins, respond: () => ({ stdout: "encrypted: yes\n" }) })),
        Effect.scoped
      )

      expect(out).toBe("encrypted: yes\n")
      expect(calls[0]?.command).toBe("sops")
      expect(calls.map(plainArgs)).toEqual([_sopsArgs({ recipients: { age: [AGE] } })])
      expect(stdins).toEqual(["url: u\n"])
    }))

  it.effect("passes a custom encryptedRegex", () =>
    Effect.gen(function*() {
      const calls: StandardCommand[] = []

      yield* sopsEncryptStdin({ plaintextYaml: "a: b\n", recipients: {}, encryptedRegex: "^data$" }).pipe(
        Effect.provide(_recording({ calls, respond: () => ({ stdout: "ok: yes\n" }) }))
      )

      const args = calls.map(plainArgs)[0] ?? []
      expect(args[args.indexOf("--encrypted-regex") + 1]).toBe("^data$")
    }))

  it.effect("a failing sops process is SopsInvocationError(op: encrypt) carrying the exit detail", () =>
    Effect.gen(function*() {
      const error = yield* Effect.flip(
        sopsEncryptStdin({ plaintextYaml: "a: b\n", recipients: {} }).pipe(
          Effect.provide(stubSpawner({ respond: () => ({ exitCode: 3, stderr: "no key\n" }) }))
        )
      )

      expect(error).toBeInstanceOf(SopsInvocationError)
      expect(error instanceof SopsInvocationError ? error.op : undefined).toBe("encrypt")
      expect(error.message).toBe("sops encrypt failed (exit 3): no key")
    }))
})

describe("sopsDecrypt", () => {
  it.effect("runs sops --decrypt on the file and returns the plaintext", () =>
    Effect.gen(function*() {
      const calls: StandardCommand[] = []

      const out = yield* sopsDecrypt({ file: "/secrets/db.enc.yaml" }).pipe(
        Effect.provide(_recording({ calls, respond: () => ({ stdout: "url: u\n" }) }))
      )

      expect(out).toBe("url: u\n")
      expect(calls.map((cmd) => [cmd.command, ...plainArgs(cmd)])).toEqual([[
        "sops",
        "--decrypt",
        "/secrets/db.enc.yaml"
      ]])
    }))

  it.effect("a failing sops process is SopsInvocationError(op: decrypt) carrying the exit detail", () =>
    Effect.gen(function*() {
      const error = yield* Effect.flip(
        sopsDecrypt({ file: "/f" }).pipe(
          Effect.provide(stubSpawner({ respond: () => ({ exitCode: 128, stderr: "boom\n" }) }))
        )
      )

      expect(error).toBeInstanceOf(SopsInvocationError)
      expect(error.op).toBe("decrypt")
      expect(error.message).toBe("sops decrypt failed (exit 128): boom")
    }))
})
