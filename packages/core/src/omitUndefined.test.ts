import * as fc from "fast-check"
import { describe, expect, it } from "vitest"
import { omitUndefined } from "./omitUndefined"

describe("omitUndefined", () => {
  it("drops exactly the undefined-valued keys and never mutates", () => {
    fc.assert(fc.property(fc.dictionary(fc.string(), fc.option(fc.integer(), { nil: undefined })), (input) => {
      const snapshot = { ...input }
      const out = omitUndefined(input)

      expect(input).toEqual(snapshot)
      expect(Object.keys(out)).toEqual(Object.keys(input).filter((k) => input[k] !== undefined))
    }))
  })
})
