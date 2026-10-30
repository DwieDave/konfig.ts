import * as fc from "fast-check"
import { describe, expect, it } from "vitest"
import { sha256Hex } from "./hash"

describe("sha256Hex", () => {
  it("matches the known digest of 'abc'", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
  })

  it("string input equals its UTF-8 bytes", () => {
    fc.assert(
      fc.property(fc.string(), (s) => sha256Hex(s) === sha256Hex(new TextEncoder().encode(s)))
    )
  })
})
