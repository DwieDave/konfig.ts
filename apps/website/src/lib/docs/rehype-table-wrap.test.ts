import type { Element, Root } from "hast"
import { toHtml } from "hast-util-to-html"
import { describe, expect, it } from "vitest"
import { TABLE_WRAP_CLASS, rehypeTableWrap } from "@/lib/docs/rehype-table-wrap"

const el = (tagName: string, children: Element["children"] = []): Element => ({
  type: "element",
  tagName,
  properties: {},
  children
})

describe("rehypeTableWrap", () => {
  it("wraps top-level and nested tables in a scroll container", () => {
    const tree: Root = {
      type: "root",
      children: [el("table"), el("p", [{ type: "text", value: "hi" }]), el("section", [el("table")])]
    }
    rehypeTableWrap()(tree)
    expect(toHtml(tree)).toBe(
      `<div class="${TABLE_WRAP_CLASS}"><table></table></div><p>hi</p><section><div class="${TABLE_WRAP_CLASS}"><table></table></div></section>`
    )
  })

  it("does not double-wrap on repeated runs", () => {
    const tree: Root = { type: "root", children: [el("table")] }
    rehypeTableWrap()(tree)
    rehypeTableWrap()(tree)
    expect(toHtml(tree)).toBe(`<div class="${TABLE_WRAP_CLASS}"><table></table></div>`)
  })
})
