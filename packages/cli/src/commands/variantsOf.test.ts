import { describe, it } from "@effect/vitest"
import * as fc from "fast-check"
import { variantsOf } from "./docker"

const emittedArb = fc.record({
  dockerfile: fc.string(),
  dockerfileDev: fc.option(fc.string({ minLength: 1 }), { nil: undefined })
})

describe("variantsOf", () => {
  it("prodOnly never yields dev", () => {
    fc.assert(
      fc.property(
        emittedArb,
        (emitted) => variantsOf({ emitted, prodOnly: true, devOnly: false }).every((v) => v.kind === "prod")
      )
    )
  })
  it("devOnly never yields prod", () => {
    fc.assert(
      fc.property(
        emittedArb,
        (emitted) => variantsOf({ emitted, prodOnly: false, devOnly: true }).every((v) => v.kind === "dev")
      )
    )
  })
  it("dev appears only when dockerfileDev is present", () => {
    fc.assert(fc.property(emittedArb, fc.boolean(), fc.boolean(), (emitted, prodOnly, devOnly) => {
      const hasDev = variantsOf({ emitted, prodOnly, devOnly }).some((v) => v.kind === "dev")
      return hasDev === (emitted.dockerfileDev !== undefined && !prodOnly)
    }))
  })
})
