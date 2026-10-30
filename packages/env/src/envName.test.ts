import * as fc from "fast-check"
import { describe, expect, it } from "vitest"
import { EnvNameCollision } from "./entry"
import { Environment } from "./environment"
import { Literal } from "./literal"

const _membersOf = (names: ReadonlyArray<string>) =>
  Object.fromEntries(names.map((envName, i) => [`m${i}`, Literal.define({ envName, value: "v" })]))

describe("env-name collision (property)", () => {
  const envName = fc
    .string({ minLength: 1, maxLength: 16 })
    .map((s) => s.replace(/[^A-Za-z0-9_]/g, "_").toUpperCase())
    .filter((s) => /^[A-Z_][A-Z0-9_]*$/.test(s))

  it("distinct envNames never collide", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(envName, { minLength: 1, maxLength: 8 }),
        (names) => {
          const members = _membersOf(names)

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
          const members = _membersOf(all)

          expect(() => Environment.define(members)).toThrow(EnvNameCollision)
        }
      )
    )
  })
})
