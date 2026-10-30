import { Effect, Layer } from "effect"
import * as Context from "effect/Context"
import fc from "fast-check"
import { describe, expect, it } from "vitest"
import { attachLayerToTag, liftBuild, liftEffect } from "./lift"
import { isParsedDoc, isRawYaml, ParsedDoc, RawYaml } from "./Manifest"
import { unwrapDocs } from "./unwrapDocs"

const _tagged = (tag: string, fields: Readonly<Record<string, number>>) =>
  Object.fromEntries([["_tag", tag], ...Object.entries(fields)])

describe("liftEffect", () => {
  it("yields plain values unchanged", () => {
    fc.assert(fc.property(fc.jsonValue(), (v) => {
      expect(Effect.runSync(liftEffect<unknown, never, never>(v))).toEqual(v)
    }))
  })
  it("passes Effects through", () => {
    const eff: Effect.Effect<number, never> = Effect.succeed(3)
    expect(Effect.runSync(liftEffect(eff))).toBe(3)
  })
})

describe("liftBuild", () => {
  it("accepts a function and an Effect", () => {
    fc.assert(fc.property(fc.array(fc.jsonValue()), (docs) => {
      expect(Effect.runSync(liftBuild(() => docs))).toEqual(docs)
      expect(Effect.runSync(liftBuild(Effect.succeed(docs)))).toEqual(docs)
    }))
  })
})

describe("attachLayerToTag", () => {
  it("returns the same tag reference with layer set", () => {
    const tag = Context.Service<"T", { x: number }>("T")
    const layer = Layer.succeed(tag, { x: 1 })
    const out = attachLayerToTag({ tag, layer })
    expect(out).toBe(tag)
    expect(out.layer).toBe(layer)
  })
})

describe("unwrapDocs", () => {
  it("unwraps ParsedDoc", () => {
    fc.assert(fc.property(fc.jsonValue(), (value) => {
      expect(unwrapDocs(ParsedDoc.make({ value }))).toEqual([value])
    }))
  })
  it("parses RawYaml", () => {
    expect(unwrapDocs(RawYaml.make({ content: "a: 1" }))).toEqual([{ a: 1 }])
  })
  it("passes null, primitives and unknown tags through", () => {
    for (const v of [null, 1, "s", true, undefined, _tagged("Other", {})]) {
      expect(unwrapDocs(v)).toEqual([v])
    }
  })
  it("guards reject malformed input", () => {
    expect(isRawYaml(RawYaml.make({ content: "a: 1" }))).toBe(true)
    expect(isRawYaml(_tagged("RawYaml", { content: 5 }))).toBe(false)
    expect(isParsedDoc(_tagged("ParsedDoc", {}))).toBe(false)
  })
})
