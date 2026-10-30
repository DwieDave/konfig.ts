import { Schema } from "effect"
import * as fc from "fast-check"
import { describe, expect, it } from "vitest"
import * as YAML from "yaml"
import { unsafeCoerce } from "../_cast"
import { filenameFor, serialize } from "./serialize"

type _ParseOptions = YAML.ParseOptions & YAML.DocumentOptions & YAML.SchemaOptions

const _parse = <T>(text: string, options?: _ParseOptions): T => {
  const parsed = YAML.parse(text, options ?? {})

  return unsafeCoerce<T>({ value: parsed, reason: "tests assert the shape of YAML that serialize just emitted" })
}

const _isString = Schema.is(Schema.String)

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
        const parsed = _parse<{ list: string[] }>(out)
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

    const parsed = _parse<{ spec: { template: { spec: { containers: { args: string[] }[] } } } }>(out)

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

    const parsed = _parse<{ spec: { template: { spec: { containers: { args: string[] }[] } } } }>(out, {
      version: "1.1"
    })

    const args = parsed.spec.template.spec.containers[0]?.args
    expect(args).toEqual([
      "--save",
      "",
      "--appendonly",
      "no",
      "--requirepass $(REDIS_PASSWORD)"
    ])

    expect(args?.every(_isString)).toBe(true)
  })

  it("YAML 1.1 bool-coercible strings remain strings (Norway problem property)", () => {
    fc.assert(
      fc.property(fc.constantFrom(...norway), (s) => {
        const out = serialize({ value: { v: s, list: [s] } })
        const back = _parse<{ v: string; list: string[] }>(out, { version: "1.1" })
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

    const back = _parse<{ annotations?: string }>(out)
    expect("annotations" in back).toBe(false)
  })

  it("preserves explicit null inside arrays (positional semantics)", () => {
    const out = serialize({ value: { list: [1, null, 3] } })
    const back = _parse<{ list: ReadonlyArray<number | null> }>(out)
    expect(back.list).toEqual([1, null, 3])
  })

  it("recursively strips nulls from nested objects", () => {
    const out = serialize({ value: { a: { b: null, c: 1 }, d: null } })
    const back = _parse<{ a: { c: number }; d?: number }>(out)
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

const _wsString = fc.string({ unit: fc.constantFrom("a", "b", " ", "\n", "\t", ":", "-"), maxLength: 12 })

const _jsonLike: fc.Arbitrary<unknown> = fc.letrec((tie) => ({
  leaf: fc.oneof(_wsString, fc.integer(), fc.boolean()),
  node: fc.oneof(
    { depthSize: "small" },
    tie("leaf"),
    fc.array(tie("node"), { maxLength: 3 }),
    fc.dictionary(fc.constantFrom("k1", "k2", "k3"), tie("node"), { maxKeys: 3 })
  )
})).node

describe("serialize — round trip", () => {
  it("parse(serialize(x)) deep-equals x, including trailing newlines and spaces", () => {
    fc.assert(
      fc.property(_jsonLike, (value) => {
        const out = serialize({ value: { root: value } })
        expect(YAML.parse(out, { version: "1.1" })).toEqual({ root: value })
      }),
      { numRuns: 500 }
    )
  })

  it("keeps a value ending in two newlines intact", () => {
    const out = serialize({ value: { data: "x\n\n" } })
    expect(YAML.parse(out)).toEqual({ data: "x\n\n" })
  })
})

describe("serialize — non-finite numbers", () => {
  it("emits NaN and Infinity as YAML specials", () => {
    expect(serialize({ value: { a: Number.NaN, b: Number.POSITIVE_INFINITY, c: Number.NEGATIVE_INFINITY } })).toBe(
      "a: .nan\nb: .inf\nc: -.inf\n"
    )
  })
})

describe("serialize — non-plain leaves", () => {
  it("emits a Date as an ISO string", () => {
    const out = serialize({
      value: { kind: "X", metadata: { name: "a" }, spec: { at: new Date("2024-01-01") } }
    })

    expect(_parse<{ spec: { at: string } }>(out).spec.at).toBe("2024-01-01T00:00:00.000Z")
  })

  const _roundTrip = (v: Date | bigint | number | boolean | string) =>
    _parse<{ spec: { v: unknown } }>(serialize({ value: { spec: { v } } }), { intAsBigInt: true }).spec.v

  it("round-trips a Date as its ISO string", () => {
    fc.assert(fc.property(fc.date({ noInvalidDate: true }), (d) => _roundTrip(d) === d.toISOString()))
  })

  it("round-trips bigint and number as their numeric value", () => {
    fc.assert(
      fc.property(fc.oneof(fc.bigInt(), fc.double({ noNaN: true })), (n) => String(_roundTrip(n)) === String(n))
    )
  })

  it("round-trips boolean and string unchanged", () => {
    fc.assert(fc.property(fc.oneof(fc.boolean(), fc.string()), (v) => _roundTrip(v) === v))
  })
})

describe("serialize — Map, Set and class instances", () => {
  type Leaf = number | boolean | string

  const _leaf = fc.oneof(fc.integer(), fc.boolean(), fc.string())

  const _spec = (
    v: Leaf | ReadonlyArray<Leaf> | ReadonlySet<Leaf> | ReadonlyMap<string, Leaf> | Record<string, Leaf>
  ) => _parse<{ spec: { v: unknown } }>(serialize({ value: { spec: { v } } })).spec.v

  it("serializes a string-keyed Map as a mapping", () => {
    fc.assert(
      fc.property(fc.dictionary(fc.string(), _leaf), (d) => {
        expect(_spec(new Map(Object.entries(d)))).toStrictEqual(_spec(d))
      })
    )
  })

  it("serializes a Set as a sequence", () => {
    fc.assert(
      fc.property(fc.array(_leaf), (a) => {
        expect(_spec(new Set(a))).toStrictEqual(a.filter((x, i) => a.indexOf(x) === i))
      })
    )
  })

  it("drops other class instances", () => {
    class Point {
      readonly x = 1
    }

    const out = serialize({ value: { kind: "X", metadata: { name: "a" }, spec: { p: new Point() } } })

    expect(_parse<{ spec: object }>(out).spec).not.toHaveProperty("p")
  })
})
