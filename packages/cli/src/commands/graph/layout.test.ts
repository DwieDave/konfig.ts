import { describe, expect, it } from "vitest"
import { detectCycle, renderGraph } from "./layout"

const node = (name: string, relDir: string, hasBuildScript = false) => ({
  name,
  relDir,
  hasBuildScript
})

describe("renderGraph — single node", () => {
  it("returns a string containing the node name and relDir", () => {
    const out = renderGraph({
      nodes: [node("@s/api", "packages/api")],
      edges: [],
      target: "@s/api",
      withDev: false,
      reduce: false
    })

    expect(out).toContain("@s/api")
    expect(out).toContain("packages/api")
  })

  it("shows a build indicator when hasBuildScript is true", () => {
    const out = renderGraph({
      nodes: [node("@s/api", "packages/api", true)],
      edges: [],
      target: "@s/api",
      withDev: false,
      reduce: false
    })

    expect(out).toContain("build")
  })
})

describe("renderGraph — parent → child tree", () => {
  it("places the child below the parent in line order", () => {
    const out = renderGraph({
      nodes: [
        node("@s/api", "packages/api"),
        node("@s/core", "packages/core")
      ],
      edges: [{ from: "@s/api", to: "@s/core", kind: "runtime" }],
      target: "@s/api",
      withDev: false,
      reduce: false
    })

    const apiIdx = out.indexOf("@s/api")
    const coreIdx = out.indexOf("@s/core")
    expect(apiIdx).toBeGreaterThanOrEqual(0)
    expect(coreIdx).toBeGreaterThan(apiIdx)
  })
})

describe("renderGraph — transitive reduction", () => {
  it("hides A→C when A→B→C also exists, only when reduce is true", () => {
    const baseInput = {
      nodes: [node("@s/a", "packages/a"), node("@s/b", "packages/b"), node("@s/c", "packages/c")],
      edges: [
        { from: "@s/a", to: "@s/b", kind: "runtime" as const },
        { from: "@s/b", to: "@s/c", kind: "runtime" as const },
        { from: "@s/a", to: "@s/c", kind: "runtime" as const }
      ],
      target: "@s/a",
      withDev: false,
      reduce: false
    }

    expect(renderGraph({ ...baseInput, reduce: false })).toContain("3 runtime edges")
    expect(renderGraph({ ...baseInput, reduce: true })).toContain("2 runtime edges")
  })
})

describe("renderGraph — dev edges", () => {
  it("hides dev-only dependencies when withDev is false", () => {
    const out = renderGraph({
      nodes: [
        node("@s/api", "packages/api"),
        node("@s/tsconfig", "packages/tsconfig")
      ],
      edges: [{ from: "@s/api", to: "@s/tsconfig", kind: "dev" }],
      target: "@s/api",
      withDev: false,
      reduce: false
    })

    expect(out).not.toContain("@s/tsconfig")
  })

  it("shows dev-only dependencies when withDev is true", () => {
    const out = renderGraph({
      nodes: [
        node("@s/api", "packages/api"),
        node("@s/tsconfig", "packages/tsconfig")
      ],
      edges: [{ from: "@s/api", to: "@s/tsconfig", kind: "dev" }],
      target: "@s/api",
      withDev: true,
      reduce: false
    })

    expect(out).toContain("@s/tsconfig")
  })
})

describe("renderGraph — monorepo mode (no target)", () => {
  it("renders multiple roots when no target is provided", () => {
    const out = renderGraph({
      nodes: [
        node("@s/api", "packages/api"),
        node("@s/web", "packages/web"),
        node("@s/utils", "packages/utils")
      ],
      edges: [
        { from: "@s/api", to: "@s/utils", kind: "runtime" },
        { from: "@s/web", to: "@s/utils", kind: "runtime" }
      ],
      target: undefined,
      withDev: false,
      reduce: false
    })

    expect(out).toContain("@s/api")
    expect(out).toContain("@s/web")
    expect(out).toContain("@s/utils")
    expect(out.indexOf("@s/utils")).toBeGreaterThan(out.indexOf("@s/api"))
    expect(out).toContain("@s/utils  (see above)")
  })
})

describe("detectCycle", () => {
  it("returns null for an acyclic graph", () => {
    const cycle = detectCycle({
      nodes: [node("a", "a"), node("b", "b")],
      edges: [{ from: "a", to: "b", kind: "runtime" }],
      withDev: true
    })

    expect(cycle).toBeNull()
  })

  it("returns the cycle path for a simple cycle", () => {
    const cycle = detectCycle({
      nodes: [node("a", "a"), node("b", "b")],
      edges: [
        { from: "a", to: "b", kind: "runtime" },
        { from: "b", to: "a", kind: "runtime" }
      ],
      withDev: true
    })

    expect(cycle).not.toBeNull()
    expect(cycle).toContain("a")
    expect(cycle).toContain("b")
  })

  it("returns the cycle including a dev edge only when withDev is true", () => {
    const input = {
      nodes: [node("a", "a"), node("b", "b")],
      edges: [
        { from: "a", to: "b", kind: "runtime" as const },
        { from: "b", to: "a", kind: "dev" as const }
      ]
    }

    expect(detectCycle({ ...input, withDev: false })).toBeNull()
    expect(detectCycle({ ...input, withDev: true })).not.toBeNull()
  })
})
