import fc from "fast-check"
import { describe, expect, expectTypeOf, it } from "vitest"
import { type GoDuration, isGoDuration } from "./duration"

const unit = fc.constantFrom("ns", "us", "µs", "ms", "s", "m", "h")

const num = fc.oneof(
  fc.nat().map(String),
  fc.tuple(fc.nat(), fc.nat()).map(([a, b]) => `${a}.${b}`)
)

const segment = fc.tuple(num, unit).map(([n, u]) => `${n}${u}`)

const duration = fc.tuple(fc.constantFrom("", "-", "+"), fc.array(segment, { minLength: 1, maxLength: 4 }))
  .map(([sign, segs]) => sign + segs.join(""))

describe("isGoDuration", () => {
  it("accepts every well-formed Go duration", () => {
    fc.assert(fc.property(duration, (d) => isGoDuration(d)))
  })

  it("rejects strings with a unit-less number or trailing garbage", () => {
    fc.assert(fc.property(fc.nat(), (n) => n === 0 || !isGoDuration(String(n))))
    fc.assert(fc.property(duration, (d) => !isGoDuration(`${d}x`) && !isGoDuration(` ${d}`)))
  })

  it("accepts known ESO examples and rejects non-strings", () => {
    for (const d of ["0", "1h30m", "500ms", "1h", "1.5s"]) expect(isGoDuration(d)).toBe(true)

    for (const d of ["", "h", "1d", "1", 5, null]) expect(isGoDuration(d)).toBe(false)
  })

  it("types", () => {
    expectTypeOf<"0">().toExtend<GoDuration>()
    expectTypeOf<"1h30m">().toExtend<GoDuration>()
    expectTypeOf<"500ms">().toExtend<GoDuration>()
    expectTypeOf<"1h">().toExtend<GoDuration>()
    expectTypeOf<"abc">().not.toExtend<GoDuration>()
    expectTypeOf<"5">().not.toExtend<GoDuration>()
    expectTypeOf<"1hx">().toExtend<GoDuration>()
  })
})
