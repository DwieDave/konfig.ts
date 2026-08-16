import type { Element, ElementContent, Root } from "hast"
import { toHtml } from "hast-util-to-html"
import { createHighlighter, type BundledLanguage, type DecorationItem } from "shiki"
import type { ResolvedDiagnostic } from "./snippets"

export type Lang = "ts" | "bash" | "yaml" | "json" | "text"

const highlighter = await createHighlighter({
  themes: ["github-dark"],
  langs: ["ts", "bash", "yaml", "json"]
})

const text = (value: string): ElementContent => ({ type: "text", value })
const el = (tagName: string, properties: Element["properties"], children: ReadonlyArray<ElementContent>): Element => ({
  type: "element",
  tagName,
  properties,
  children: [...children]
})

const tooltip = (d: ResolvedDiagnostic): Element =>
  el("span", { class: "diag-tip", role: "tooltip" }, [
    el("span", { class: "diag-heading" }, [text("error ")]),
    el("span", { class: "diag-code" }, [text(`TS${d.code}: `)]),
    text(d.message)
  ])

const toDecoration = (d: ResolvedDiagnostic, index: number): DecorationItem => ({
  start: { line: d.line, character: d.colStart },
  end: { line: d.line, character: d.colEnd },
  alwaysWrap: true,
  properties: { class: "diag", tabindex: "0", "data-diag": String(index), "aria-label": `TS${d.code}: ${d.message}` }
})

// Tooltips are appended in a separate pass: mutating children inside a
// decoration `transform` makes shiki drop the token tail after the range.
const appendTooltips = (node: Root | Element, diagnostics: ReadonlyArray<ResolvedDiagnostic>): void => {
  for (const child of node.children) {
    if (child.type !== "element") continue
    const index = child.properties["data-diag"]
    const d = typeof index === "string" ? diagnostics[Number(index)] : undefined
    if (d !== undefined) child.children.push(tooltip(d))
    else appendTooltips(child, diagnostics)
  }
}

export const highlight = (
  code: string,
  lang: Lang,
  diagnostics: ReadonlyArray<ResolvedDiagnostic> = []
): string => {
  const language: BundledLanguage | "text" = lang === "text" ? "text" : lang
  const hast = highlighter.codeToHast(code, {
    lang: language,
    theme: "github-dark",
    decorations: diagnostics.map((d, i) => toDecoration(d, i)),
    transformers: [
      {
        pre(node) {
          // Drop shiki's inline background: the CodeBlock frame owns the surface.
          delete node.properties["style"]
          node.properties["tabindex"] = "-1"
        },
        line(node, line) {
          const hit = diagnostics.some((d) => d.line === line - 1)
          if (hit) node.properties["data-diag-line"] = ""
        }
      }
    ]
  })
  appendTooltips(hast, diagnostics)
  return toHtml(hast)
}
