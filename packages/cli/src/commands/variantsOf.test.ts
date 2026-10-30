import { describe, it } from "@effect/vitest"
import { Option } from "effect"
import * as fc from "fast-check"
import { variantsOf } from "./docker"

const emittedArb = fc.record({
  dockerfile: fc.string(),
  dockerfileDev: fc.option(fc.string({ minLength: 1 }), { nil: undefined })
})

const onlyArb = fc.constantFrom(Option.none(), Option.some("prod" as const), Option.some("dev" as const))

describe("variantsOf", () => {
  it("only prod never yields dev", () => {
    fc.assert(
      fc.property(
        emittedArb,
        (emitted) => variantsOf({ emitted, only: Option.some("prod") }).every((v) => v.kind === "prod")
      )
    )
  })
  it("only dev never yields prod", () => {
    fc.assert(
      fc.property(
        emittedArb,
        (emitted) => variantsOf({ emitted, only: Option.some("dev") }).every((v) => v.kind === "dev")
      )
    )
  })
  it("dev appears only when dockerfileDev is present and not restricted to prod", () => {
    fc.assert(fc.property(emittedArb, onlyArb, (emitted, only) => {
      const hasDev = variantsOf({ emitted, only }).some((v) => v.kind === "dev")

      return hasDev === (emitted.dockerfileDev !== undefined && !Option.contains(only, "prod"))
    }))
  })
})
