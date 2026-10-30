import { Config, Schema } from "effect"
import { describe, expect, it } from "vitest"
import { _makeEntry } from "./entry"
import { Literal } from "./literal"

describe("_makeEntry", () => {
  it("does not mutate the shared config", () => {
    const shared = Schema.String
    const a = Literal.define({ envName: "A", value: "1", schema: shared })
    const b = Literal.define({ envName: "B", value: "2", schema: shared })
    expect(a).not.toBe(b)
    expect(a.envName).toBe("A")
    expect(b.envName).toBe("B")
    expect(Object.keys(shared)).not.toContain("envName")
  })

  it("returns a new object keeping the prototype and metadata", () => {
    const config = Config.String("X")
    const entry = _makeEntry({ config, metadata: { tag: 1 } })
    expect(entry).not.toBe(config)
    expect(Object.getPrototypeOf(entry)).toBe(Object.getPrototypeOf(config))
    expect(entry.tag).toBe(1)
  })
})
