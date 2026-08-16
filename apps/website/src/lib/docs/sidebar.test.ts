import { describe, expect, it } from "vitest"
import { buildSidebar, flatten, groupLabel, type DocEntry } from "./sidebar"

const e = (id: string, order?: number, hidden?: boolean): DocEntry => ({
  id,
  data: { title: id, sidebar: { order, hidden } }
})

describe("buildSidebar", () => {
  const entries = [
    e("getting-started/introduction", 0),
    e("getting-started/installation", 1),
    e("concepts/branded-refs", 2),
    e("concepts/dependency-graph", 1),
    e("concepts/hidden", 0, true),
    e("faq", 99),
    e("cli/build")
  ]
  const items = buildSidebar(entries, "concepts/dependency-graph", { "getting-started": 0, concepts: 1, cli: 2 })

  it("orders groups by config, roots by order, and mixes them", () => {
    expect(items.map((i) => (i.kind === "group" ? i.group.dir : i.entry.id))).toEqual([
      "getting-started",
      "concepts",
      "cli",
      "faq"
    ])
  })

  it("orders entries inside a group and opens the current one", () => {
    const concepts = items.find((i) => i.kind === "group" && i.group.dir === "concepts")
    expect(concepts?.kind).toBe("group")
    if (concepts?.kind !== "group") return
    expect(concepts.group.isOpen).toBe(true)
    expect(concepts.group.entries.map((x) => x.id)).toEqual(["concepts/dependency-graph", "concepts/branded-refs"])
  })

  it("drops hidden entries", () => {
    expect(flatten(items).some((x) => x.id === "concepts/hidden")).toBe(false)
  })

  it("labels groups from their directory", () => {
    expect(groupLabel("getting-started")).toBe("Getting Started")
    expect(groupLabel("cli")).toBe("CLI")
  })
})
