import * as fc from "fast-check"
import { describe, expect, it } from "vitest"
import { EnvNameCollision } from "./entry"
import { Environment } from "./environment"
import { Literal } from "./literal"

describe("env-name collision (property)", () => {
  // Generate N distinct env-var names; assemble an env from one literal
  // per name. Should never collide.
  const envName = fc
    .string({ minLength: 1, maxLength: 16 })
    .map((s) => s.replace(/[^A-Za-z0-9_]/g, "_").toUpperCase())
    .filter((s) => /^[A-Z_][A-Z0-9_]*$/.test(s))

  it("distinct envNames never collide", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(envName, { minLength: 1, maxLength: 8 }),
        (names) => {
          const members: Record<string, ReturnType<typeof Literal.define>> = {}
          for (let i = 0; i < names.length; i++) {
            members[`m${i}`] = Literal.define({ envName: names[i] as string, value: "v" })
          }
          expect(() => Environment.define(members)).not.toThrow()
        }
      )
    )
  })

  it("any repeated envName triggers a collision", () => {
    fc.assert(
      fc.property(
        envName,
        fc.uniqueArray(envName, { minLength: 1, maxLength: 4 }),
        (dup, rest) => {
          const all = [dup, dup, ...rest.filter((n) => n !== dup)]
          const members: Record<string, ReturnType<typeof Literal.define>> = {}
          for (let i = 0; i < all.length; i++) {
            members[`m${i}`] = Literal.define({ envName: all[i] as string, value: "v" })
          }
          expect(() => Environment.define(members)).toThrow(EnvNameCollision)
        }
      )
    )
  })
})
