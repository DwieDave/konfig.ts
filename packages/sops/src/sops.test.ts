import { NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Effect, Exit, Schema } from "effect"
import * as fc from "fast-check"
import { describe, expect, it as plainIt } from "vitest"
import type { SopsRecipients } from "./schema"
import { _recipientArgs, _sopsArgs, sopsArgs } from "./sops"

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

describe("sopsArgs recipient rejection property", () => {
  const _tainted = fc.tuple(_agePool, fc.constantFrom(",", ";", " ", "$", "`", "|"), fc.string({ minLength: 1 }))
    .map(([age, sep, tail]) => `${age}${sep}${tail}`)

  it.effect("rejects any recipient that is not a plain age key", () =>
    Effect.promise(() =>
      fc.assert(fc.asyncProperty(_tainted, (bad) =>
        Effect.runPromise(
          Effect.gen(function*() {
            const exit = yield* Effect.exit(
              sopsArgs({ recipients: { age: [bad] }, label: "L" })
            )

            expect(Exit.isFailure(exit)).toBe(true)
          }).pipe(Effect.provide(NodeServices.layer))
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

describe("sopsArgs validates recipients itself", () => {
  it.effect("rejects an unvalidated age recipient containing a comma", () =>
    Effect.gen(function*() {
      const exit = yield* Effect.exit(
        sopsArgs({
          label: "Sops(ns/n)",
          recipients: {
            age: [
              "age1stub00000000000000000000000000000000000000000000000000ends,age1injected00000000000000000000000000000000000000000leak"
            ]
          }
        })
      )

      expect(Exit.isFailure(exit)).toBe(true)

      if (Exit.isFailure(exit)) {
        const text = yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(exit.cause)
        expect(text).toContain("SopsRecipients")
        expect(text).toContain("RenderError")
        expect(text).toContain("Sops(ns/n)")
      }
    }).pipe(Effect.provide(NodeServices.layer)))
})
