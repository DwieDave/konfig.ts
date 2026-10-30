import fc from "fast-check"
import { describe, it } from "vitest"
import { lint } from "../test-support.ts"
import { noComments } from "./no-comments.ts"
import { noMultipleFunctionParams } from "./no-multiple-function-params.ts"
import { privateFunctionPrefix } from "./private-function-prefix.ts"

const identifier = fc.stringMatching(/^[a-z][a-zA-Z0-9]{0,12}$/)

describe("rule properties", () => {
  it("no-comments flags a line comment exactly when it exceeds 150 chars", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 300 }), (length) => {
        const reports = lint({ rule: noComments, source: `//${"x".repeat(length)}\nconst a = 1` })

        return reports.length === (length > 150 ? 1 : 0)
      })
    )
  })

  it("private-function-prefix flags bare names unless they are exported", () => {
    fc.assert(
      fc.property(identifier, fc.boolean(), (name, exported) => {
        const source = `function ${name}() {}\n${exported ? `export { ${name} }` : ""}`

        return lint({ rule: privateFunctionPrefix, source }).length === (exported ? 0 : 1)
      })
    )
  })

  it("no-multiple-function-params reports a non-callback function iff it has more than one param", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 4 }),
        fc.integer({ min: 0, max: 4 }),
        fc.boolean(),
        (depth, count, arrow) => {
          const params = Array.from({ length: count }, (_, index) => `p${index}`).join(", ")

          const target = arrow ? `const t = (${params}) => 1` : `function t(${params}) {}`

          const source = Array.from({ length: depth }).reduce<string>(
            (inner, _, level) => `const w${level} = () => { ${inner} }`,
            target
          )

          const reports = lint({ rule: noMultipleFunctionParams, source, options: [{ scope: "all" }] })

          return reports.length === (count > 1 ? 1 : 0)
        }
      )
    )
  })
})
