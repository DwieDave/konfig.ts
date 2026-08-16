import type { Element, ElementContent } from "hast"
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

const toDecoration = (d: ResolvedDiagnostic): DecorationItem => ({
  start: { line: d.line, character: d.colStart },
  end: { line: d.line, character: d.colEnd },
  alwaysWrap: true,
  properties: { class: "diag", tabindex: "0", "aria-label": `TS${d.code}: ${d.message}` },
  transform: (element, type) => {
    if (type === "wrapper") element.children.push(tooltip(d))
    return element
  }
})

export const highlight = (
  code: string,
  lang: Lang,
  diagnostics: ReadonlyArray<ResolvedDiagnostic> = []
): string => {
  const language: BundledLanguage | "text" = lang === "text" ? "text" : lang
  return highlighter.codeToHtml(code, {
    lang: language,
    theme: "github-dark",
    decorations: diagnostics.map(toDecoration),
    transformers: [
      {
        pre(node) {
          // Drop shiki's inline background — the CodeBlock frame owns the surface.
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
}
