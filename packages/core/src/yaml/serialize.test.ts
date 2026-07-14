import * as fc from "fast-check"
import { describe, expect, it } from "vitest"
import * as YAML from "yaml"
import { filenameFor, serialize } from "./serialize"

describe("serialize — key order (FR-2.1 / FR-2.2)", () => {
  it("places apiVersion, kind, metadata, spec, status before alphabetical extras", () => {
    const resource = {
      zzExtra: "z",
      status: { phase: "Pending" },
      spec: { replicas: 1 },
      metadata: { name: "n" },
      apiVersion: "v1",
      kind: "Pod",
      aaExtra: "a"
    }
    const out = serialize({ value: resource })
    const topKeys = out
      .split("\n")
      .filter((l) => /^[A-Za-z]/.test(l))
      .map((l) => l.split(":")[0])
    expect(topKeys).toEqual([
      "apiVersion",
      "kind",
      "metadata",
      "spec",
      "status",
      "aaExtra",
      "zzExtra"
    ])
  })

  it("places metadata keys as name, namespace, labels, annotations, then alphabetical", () => {
    const resource = {
      apiVersion: "v1",
      kind: "Pod",
      metadata: {
        zzExtra: "z",
        annotations: { foo: "bar" },
        labels: { app: "p" },
        namespace: "ns",
        name: "n",
        aaExtra: "a"
      }
    }
    const out = serialize({ value: resource })
    const metaBlock = out.split("metadata:\n")[1] ?? ""
    const metaKeys = metaBlock
      .split("\n")
      .filter((l) => /^ {2}[A-Za-z]/.test(l))
      .map((l) => l.trim().split(":")[0])
    expect(metaKeys).toEqual(["name", "namespace", "labels", "annotations", "aaExtra", "zzExtra"])
  })

  it("nested metadata (depth > 1) is alphabetical", () => {
    const resource = {
      apiVersion: "v1",
      kind: "Pod",
      spec: {
        template: {
          metadata: {
            name: "n",
            annotations: { a: "1" },
            labels: { app: "p" }
          }
        }
      }
    }
    const out = serialize({ value: resource })
    const idxAnn = out.indexOf("annotations:")
    const idxLab = out.indexOf("labels:")
    const idxName = out.indexOf("name:")
    expect(idxAnn).toBeLessThan(idxLab)
    expect(idxLab).toBeLessThan(idxName)
  })
})

describe("serialize — list order (FR-2.3)", () => {
  it("preserves list element order", () => {
    fc.assert(
      fc.property(fc.array(fc.string({ minLength: 1, maxLength: 5 }), { minLength: 1 }), (xs) => {
        const out = serialize({ value: { list: xs } })
        const parsed = YAML.parse(out) as { list: string[] }
        expect(parsed.list).toEqual(xs)
      })
    )
  })

  it("preserves container args (the load-bearing case)", () => {
    const args = ["-zap-time-encoding=iso8601", "-zap-stacktrace-level=error", "-leader-elect"]
    const out = serialize({
      value: {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "x" },
        spec: { template: { spec: { containers: [{ name: "c", args }] } } }
      }
    })
    const parsed = YAML.parse(out) as {
      spec: { template: { spec: { containers: { args: string[] }[] } } }
    }
    expect(parsed.spec.template.spec.containers[0]?.args).toEqual(args)
  })
})

describe("serialize — round-trip (FR-2.7, NFR-4.3)", () => {
  const arbJson: fc.Arbitrary<unknown> = fc.letrec((tie) => ({
    val: fc.oneof(
      fc.string({ minLength: 1, maxLength: 8 }),
      fc.integer({ min: -1000, max: 1000 }),
      fc.boolean(),
      tie("obj"),
      tie("arr")
    ),
    obj: fc.dictionary(
      fc.string({ minLength: 1, maxLength: 5 }).filter((s) => /^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(s)),
      tie("val"),
      { maxKeys: 4 }
    ),
    arr: fc.array(tie("val"), { maxLength: 4 })
  })).obj

  it("parsed YAML equals the input value (structurally) for null-free trees", () => {
    fc.assert(
      fc.property(arbJson, (input) => {
        const out = serialize({ value: input })
        const back = YAML.parse(out)
        expect(back).toEqual(input)
      }),
      { numRuns: 100 }
    )
  })
})

describe("serialize — YAML 1.1 reader safety (kubectl/go-yaml parity)", () => {
  // kubectl and go-yaml parse manifests with YAML 1.1 semantics, where unquoted
  // yes/no/on/off/y/n (and case variants) are coerced to booleans. The emitter
  // must quote such string values so they survive a 1.1 reader as strings.
  const norway = [
    "no",
    "No",
    "NO",
    "yes",
    "Yes",
    "YES",
    "on",
    "On",
    "ON",
    "off",
    "Off",
    "OFF",
    "y",
    "Y",
    "n",
    "N"
  ]

  it("argocd-redis args round-trip under a YAML 1.1 parser (regression)", () => {
    const value = {
      apiVersion: "apps/v1",
      kind: "Deployment",
      metadata: { name: "argocd-redis" },
      spec: {
        template: {
          spec: {
            containers: [
              {
                name: "redis",
                args: ["--save", "", "--appendonly", "no", "--requirepass $(REDIS_PASSWORD)"]
              }
            ]
          }
        }
      }
    }
    const out = serialize({ value })
    const parsed = YAML.parse(out, { version: "1.1" }) as {
      spec: { template: { spec: { containers: { args: unknown[] }[] } } }
    }
    const args = parsed.spec.template.spec.containers[0]?.args
    expect(args).toEqual([
      "--save",
      "",
      "--appendonly",
      "no",
      "--requirepass $(REDIS_PASSWORD)"
    ])
    for (const a of args ?? []) expect(typeof a).toBe("string")
  })

  it("YAML 1.1 bool-coercible strings remain strings (Norway problem property)", () => {
    fc.assert(
      fc.property(fc.constantFrom(...norway), (s) => {
        const out = serialize({ value: { v: s, list: [s] } })
        const back = YAML.parse(out, { version: "1.1" }) as { v: unknown; list: unknown[] }
        expect(back.v).toBe(s)
        expect(back.list[0]).toBe(s)
      })
    )
  })
})

describe("serialize — null stripping (helm parity)", () => {
  it("drops object keys whose value is null", () => {
    const out = serialize({
      value: {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "x" },
        annotations: null
      }
    })
    const back = YAML.parse(out) as Record<string, unknown>
    expect("annotations" in back).toBe(false)
  })

  it("preserves explicit null inside arrays (positional semantics)", () => {
    const out = serialize({ value: { list: [1, null, 3] } })
    const back = YAML.parse(out) as { list: unknown[] }
    expect(back.list).toEqual([1, null, 3])
  })

  it("recursively strips nulls from nested objects", () => {
    const out = serialize({ value: { a: { b: null, c: 1 }, d: null } })
    const back = YAML.parse(out) as { a: { c: number }; d?: unknown }
    expect(back.a).toEqual({ c: 1 })
    expect("d" in back).toBe(false)
  })
})

describe("serialize — line endings (FR-2.6)", () => {
  it("uses LF and ends with exactly one newline", () => {
    const out = serialize({ value: { apiVersion: "v1", kind: "Pod", metadata: { name: "n" } } })
    expect(out.includes("\r")).toBe(false)
    expect(out.endsWith("\n")).toBe(true)
    expect(out.endsWith("\n\n")).toBe(false)
  })

  it("no trailing whitespace on any line", () => {
    const out = serialize({
      value: {
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name: "n", labels: { a: "1" } }
      }
    })
    for (const line of out.split("\n")) {
      expect(line).toBe(line.trimEnd())
    }
  })
})

describe("filenameFor (FR-2.5)", () => {
  it("returns Kind-name.yaml", () => {
    expect(filenameFor({ kind: "Deployment", metadata: { name: "api" } })).toBe(
      "Deployment-api.yaml"
    )
  })

  it("throws when kind is missing", () => {
    expect(() => filenameFor({ metadata: { name: "x" } })).toThrow()
  })

  it("throws when metadata.name is missing", () => {
    expect(() => filenameFor({ kind: "Pod", metadata: {} })).toThrow()
  })
})
