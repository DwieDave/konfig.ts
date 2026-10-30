import fc from "fast-check"
import { describe, it } from "vitest"
import { lint } from "../test-support.ts"
import { noComments } from "./no-comments.ts"
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
})
