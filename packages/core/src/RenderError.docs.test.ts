import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import type { AnyRenderError } from "./RenderError"

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false

const _tags = [
  "RenderError",
  "EmbedYamlReadError",
  "YamlParseError",
  "BoundaryDecodeError",
  "HelmVersionTooLow",
  "HelmMinVersionInvalid",
  "HelmRenderError",
  "HelmDigestMismatch",
  "CrdExtractError"
] as const

const _pin: Equal<AnyRenderError["_tag"], (typeof _tags)[number]> = true

const _docs = ["../README.md", "../../../apps/website/src/content/docs/packages/core.mdx"]

describe("AnyRenderError docs", () => {
  it("pins the tag union", () => {
    expect(_pin).toBe(true)
  })

  it.each(_docs)("%s lists every tag", (path) => {
    const text = readFileSync(new URL(path, import.meta.url), "utf8")

    expect(_tags.filter((tag) => !text.includes(tag))).toEqual([])
  })
})
