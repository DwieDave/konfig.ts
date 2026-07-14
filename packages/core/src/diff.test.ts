import { describe, expect, it } from "vitest"
import { deepEqual, diffFiles, formatDiff, hasDifferences, redact } from "./diff"

describe("redact (FR-3.2)", () => {
  it("strips helm.sh/chart label", () => {
    const r = redact({
      value: {
        apiVersion: "v1",
        kind: "Pod",
        metadata: {
          name: "p",
          labels: { app: "x", "helm.sh/chart": "foo-0.1.0" }
        }
      }
    })
    expect(r).toEqual({
      apiVersion: "v1",
      kind: "Pod",
      metadata: { name: "p", labels: { app: "x" } }
    })
  })

  it("strips app.kubernetes.io/managed-by=Helm but keeps non-Helm values", () => {
    const r = redact({
      value: { metadata: { labels: { "app.kubernetes.io/managed-by": "Helm", other: "v" } } }
    }) as { metadata: { labels: Record<string, string> } }
    expect(r.metadata.labels["app.kubernetes.io/managed-by"]).toBeUndefined()
    expect(r.metadata.labels.other).toBe("v")

    const r2 = redact({
      value: { metadata: { labels: { "app.kubernetes.io/managed-by": "argocd" } } }
    }) as { metadata: { labels: Record<string, string> } }
    expect(r2.metadata.labels["app.kubernetes.io/managed-by"]).toBe("argocd")
  })

  it("strips meta.helm.sh/* annotations", () => {
    const r = redact({
      value: {
        metadata: {
          annotations: {
            "meta.helm.sh/release-name": "x",
            "meta.helm.sh/release-namespace": "ns",
            keep: "v"
          }
        }
      }
    }) as { metadata: { annotations: Record<string, string> } }
    expect(r.metadata.annotations).toEqual({ keep: "v" })
  })

  it("does NOT strip helm.sh/chart on nested (non-metadata) labels", () => {
    const r = redact({
      value: { spec: { selector: { matchLabels: { "helm.sh/chart": "x" } } } }
    }) as { spec: { selector: { matchLabels: Record<string, string> } } }
    expect(r.spec.selector.matchLabels["helm.sh/chart"]).toBe("x")
  })
})

describe("deepEqual", () => {
  it("treats key order as irrelevant for maps", () => {
    expect(deepEqual({ a: { a: 1, b: 2 }, b: { b: 2, a: 1 } })).toBe(true)
  })
  it("treats list order as meaningful", () => {
    expect(deepEqual({ a: [1, 2, 3], b: [3, 2, 1] })).toBe(false)
  })
  it("string-vs-number is not equal", () => {
    expect(deepEqual({ a: { x: "1" }, b: { x: 1 } })).toBe(false)
  })
})

describe("diffFiles (FR-3.3)", () => {
  it("reports MissingLeft / MissingRight / Changed / Same", () => {
    const left = {
      "Pod-a.yaml": "apiVersion: v1\nkind: Pod\nmetadata:\n  name: a\n",
      "Pod-shared.yaml": "apiVersion: v1\nkind: Pod\nmetadata:\n  name: shared\n",
      "Pod-b.yaml": "apiVersion: v1\nkind: Pod\nmetadata:\n  name: b\n"
    }
    const right = {
      "Pod-shared.yaml": "kind: Pod\napiVersion: v1\nmetadata:\n  name: shared\n",
      "Pod-b.yaml": "apiVersion: v1\nkind: Pod\nmetadata:\n  name: bee\n",
      "Pod-c.yaml": "apiVersion: v1\nkind: Pod\nmetadata:\n  name: c\n"
    }
    const result = diffFiles({ left, right })
    const byFile = Object.fromEntries(result.entries.map((e) => [e.file, e._tag]))
    expect(byFile["Pod-a.yaml"]).toBe("MissingRight")
    expect(byFile["Pod-c.yaml"]).toBe("MissingLeft")
    expect(byFile["Pod-shared.yaml"]).toBe("Same")
    expect(byFile["Pod-b.yaml"]).toBe("Changed")
    expect(hasDifferences(result)).toBe(true)
  })

  it("ignored fields don't cause spurious diffs", () => {
    const left = {
      "Pod-a.yaml":
        "apiVersion: v1\nkind: Pod\nmetadata:\n  name: a\n  labels:\n    helm.sh/chart: foo-1.0\n    app: x\n"
    }
    const right = {
      "Pod-a.yaml": "apiVersion: v1\nkind: Pod\nmetadata:\n  name: a\n  labels:\n    app: x\n"
    }
    const r = diffFiles({ left, right })
    expect(hasDifferences(r)).toBe(false)
  })
})

describe("formatDiff (FR-3.4)", () => {
  it("summary lists changed files only", () => {
    const left = { "Pod-a.yaml": "kind: Pod\nmetadata:\n  name: a\n" }
    const right = { "Pod-a.yaml": "kind: Pod\nmetadata:\n  name: b\n" }
    const out = formatDiff({ result: diffFiles({ left, right }), format: "summary" })
    expect(out).toContain("Pod-a.yaml")
  })
  it("json is parseable", () => {
    const left = { "Pod-a.yaml": "kind: Pod\nmetadata:\n  name: a\n" }
    const right = { "Pod-a.yaml": "kind: Pod\nmetadata:\n  name: b\n" }
    const out = formatDiff({ result: diffFiles({ left, right }), format: "json" })
    expect(() => JSON.parse(out)).not.toThrow()
  })
})
