import * as fc from "fast-check"
import { describe, expect, it } from "vitest"
import { shJoin } from "./shell"

const splitWords = (s: string): ReadonlyArray<string> => {
  const out: string[] = []
  let cur = ""
  let started = false
  let i = 0

  while (i < s.length) {
    const c = s[i]!

    if (c === "'") {
      const end = s.indexOf("'", i + 1)
      cur += s.slice(i + 1, end)
      started = true
      i = end + 1
    } else if (c === "\\") {
      cur += s[i + 1]
      started = true
      i += 2
    } else if (c === " ") {
      if (started) out.push(cur)
      cur = ""
      started = false
      i++
    } else {
      cur += c
      started = true
      i++
    }
  }

  if (started) out.push(cur)

  return out
}

describe("shJoin", () => {
  it("round-trips arbitrary argv through shell word splitting", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.string({
            minLength: 1,
            unit: fc.constantFrom("a", "b", " ", "'", "\"", "$", "&", ";", "\\", "*", "-", "/")
          }),
          {
            minLength: 1
          }
        ),
        (argv) => {
          expect(splitWords(shJoin(argv))).toEqual(argv)
        }
      )
    )
  })

  it("leaves safe tokens unquoted", () => {
    expect(shJoin(["bun", "build", "./src/main.ts", "--outdir=dist"])).toBe("bun build ./src/main.ts --outdir=dist")
  })
})
