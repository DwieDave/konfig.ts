import type { Element, Parents, Root } from "hast"

/**
 * Rehype plugin: wraps every `<table>` rendered from docs Markdown/MDX in a
 * horizontally scrolling container.
 *
 * Why: Tailwind Typography lays tables out as plain `display: table` blocks.
 * A cell holding an unbreakable token (e.g. `<root>/<outDir.manifests>/<env>`)
 * pushes the table's min-content width past the prose column, and nothing
 * between the table and `<html>` clips it — so the whole document scrolls
 * sideways on narrow viewports. Wrapping at the render layer fixes it once for
 * every page instead of relying on authors to remember a wrapper in MDX.
 */
export const TABLE_WRAP_CLASS = "docs-table-wrap"

const isElement = (node: Parents["children"][number]): node is Element => node.type === "element"

const isWrapper = (node: Parents): boolean => {
  if (node.type !== "element") return false
  const className = node.properties["className"]
  return Array.isArray(className) && className.includes(TABLE_WRAP_CLASS)
}

const wrapTables = (parent: Parents): void => {
  parent.children = parent.children.map((child) => {
    if (!isElement(child)) return child
    if (child.tagName === "table" && !isWrapper(parent)) {
      const wrapper: Element = {
        type: "element",
        tagName: "div",
        properties: { className: [TABLE_WRAP_CLASS] },
        children: [child]
      }
      return wrapper
    }
    wrapTables(child)
    return child
  })
}

export const rehypeTableWrap = () => (tree: Root) => {
  wrapTables(tree)
}
