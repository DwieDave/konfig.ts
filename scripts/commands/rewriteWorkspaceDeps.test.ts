import { Console, Effect, Exit } from "effect"
import fc from "fast-check"
import { describe, expect, it } from "vitest"
import { type PackageJson, REPO_ROOT } from "../lib/repo"
import { makeStubLayer } from "../lib/stubFs"
import type { DepRecord } from "./rewriteWorkspaceDeps"
import {
  caretRange,
  resolveCatalogSpec,
  resolveWorkspaceSpec,
  rewritePackage,
  rewriteRecord
} from "./rewriteWorkspaceDeps"

interface Base {
  readonly catalog: DepRecord
  readonly namedCatalogs: Record<string, DepRecord>
  readonly pkgJsonPath: string
}

const _base: Base = {
  catalog: { yaml: "2.9.0" },
  namedCatalogs: { test: { vitest: "4.1.10" } },
  pkgJsonPath: "packages/example/package.json"
}

const _rewrite = (rec: DepRecord | undefined, base = _base, version = "1.2.3") =>
  Effect.runSync(rewriteRecord({ ...base, rec, version }))

describe("rewriteRecord", () => {
  it("returns undefined for an undefined record", () => {
    expect(_rewrite(undefined)).toBeUndefined()
  })

  it("resolves workspace:* / ^ / ~ / explicit versions without mutating the input", () => {
    const rec: DepRecord = {
      "@konfig.ts/core": "workspace:*",
      "@konfig.ts/k8s": "workspace:^",
      "@konfig.ts/env": "workspace:~",
      "@konfig.ts/sops": "workspace:2.0.0"
    }

    const out = _rewrite(rec)
    expect(out).toEqual({
      "@konfig.ts/core": "1.2.3",
      "@konfig.ts/k8s": "^1.2.3",
      "@konfig.ts/env": "~1.2.3",
      "@konfig.ts/sops": "2.0.0"
    })
    expect(rec["@konfig.ts/core"]).toBe("workspace:*")
  })

  it("never emits workspace: or catalog: specs", () => {
    const spec = fc.constantFrom("workspace:*", "workspace:^", "workspace:~", "workspace:1.0.0", "catalog:", "^1.0.0")
    const names = fc.string().map((s) => `@konfig.ts/${s}`)

    fc.assert(
      fc.property(fc.dictionary(names, spec), (rec) => {
        const base = { ..._base, catalog: Object.fromEntries(Object.keys(rec).map((k) => [k, "1.0.0"])) }
        const out = Object.values(_rewrite(rec, base) ?? {})
        expect(out.some((v) => v.includes("workspace:") || v.includes("catalog:"))).toBe(false)
      })
    )
  })

  it("fails on unresolvable workspace: specs", () => {
    const recs: Array<DepRecord> = [{ "some-lib": "workspace:*" }, { "@konfig.ts/core": "workspace:../core" }]

    for (const rec of recs) {
      expect(Exit.isFailure(Effect.runSyncExit(rewriteRecord({ ..._base, rec, version: "1.0.0" })))).toBe(true)
    }
  })

  it("resolves catalog: against the default catalog", () => {
    expect(_rewrite({ yaml: "catalog:" })).toEqual({ yaml: "2.9.0" })
  })

  it("resolves catalog:<name> against the named catalog", () => {
    expect(_rewrite({ vitest: "catalog:test" })).toEqual({ vitest: "4.1.10" })
  })

  it("emits a caret range for the effect family and pins the rest", () => {
    const base = { ..._base, catalog: { effect: "4.0.5", "@effect/platform-node": "4.0.5", yaml: "2.9.0" } }
    const rec: DepRecord = { effect: "catalog:", "@effect/platform-node": "catalog:", yaml: "catalog:" }
    expect(_rewrite(rec, base)).toEqual({ effect: "^4.0.5", "@effect/platform-node": "^4.0.5", yaml: "2.9.0" })
  })

  describe("caretRange", () => {
    it.each([
      ["4.0.0-rc.111", "^4.0.0-rc.111"],
      ["^4.0.0-rc.7", "^4.0.0-rc.7"],
      ["~4.0.0-beta.2", "^4.0.0-beta.2"],
      ["4.1.0", "^4.1.0"],
      ["~4.0.5", "^4.0.5"],
      ["^5.0.0", "^5.0.0"],
      [">=4.0.0 <5.0.0", ">=4.0.0 <5.0.0"]
    ])("%s → %s", (input, expected) => {
      expect(caretRange(input)).toBe(expected)
    })
  })

  it("leaves plain semver specs unchanged", () => {
    expect(_rewrite({ semver: "^1.0.0" })).toEqual({ semver: "^1.0.0" })
  })

  it("fails when a catalog: spec has no matching entry", () => {
    expect(Exit.isFailure(Effect.runSyncExit(rewriteRecord({ ..._base, rec: { missing: "catalog:" }, version: "1" }))))
      .toBe(true)
  })
})

describe("resolveWorkspaceSpec", () => {
  it("maps * ^ ~ to exact/caret/tilde and keeps explicit versions", () => {
    fc.assert(fc.property(fc.tuple(fc.nat(), fc.nat(), fc.nat()), (parts) => {
      const version = parts.join(".")
      expect(resolveWorkspaceSpec({ spec: "workspace:*", version })).toBe(version)
      expect(resolveWorkspaceSpec({ spec: "workspace:^", version })).toBe(`^${version}`)
      expect(resolveWorkspaceSpec({ spec: "workspace:~", version })).toBe(`~${version}`)
      expect(resolveWorkspaceSpec({ spec: `workspace:${version}`, version: "9.9.9" })).toBe(version)
      expect(resolveWorkspaceSpec({ spec: `workspace:^${version}`, version: "9.9.9" })).toBe(`^${version}`)
      expect(resolveWorkspaceSpec({ spec: `workspace:~${version}`, version: "9.9.9" })).toBe(`~${version}`)
    }))
  })
})

describe("resolveCatalogSpec", () => {
  const input = (name: string, spec: string) => ({
    ..._base,
    catalog: { effect: "4.0.5", yaml: "2.9.0" },
    rec: undefined,
    version: "1.0.0",
    name,
    spec
  })

  it("resolves default, named, and effect-family caret", () => {
    expect(Effect.runSync(resolveCatalogSpec(input("yaml", "catalog:")))).toBe("2.9.0")
    expect(Effect.runSync(resolveCatalogSpec(input("vitest", "catalog:test")))).toBe("4.1.10")
    expect(Effect.runSync(resolveCatalogSpec(input("effect", "catalog:")))).toBe("^4.0.5")
  })
  it("fails on missing default and missing named catalogs", () => {
    expect(Exit.isFailure(Effect.runSyncExit(resolveCatalogSpec(input("nope", "catalog:"))))).toBe(true)
    expect(Exit.isFailure(Effect.runSyncExit(resolveCatalogSpec(input("yaml", "catalog:ghost"))))).toBe(true)
  })
})

describe("rewritePackage", () => {
  const dir = `${REPO_ROOT}packages/a`
  const file = `${dir}/package.json`

  const run = (pkg: PackageJson) => {
    const files = new Map([[file, JSON.stringify(pkg)]])
    const logs: Array<string> = []
    const logger: Console.Console = { ...console, log: (m: string) => void logs.push(m) }
    Effect.runSync(
      rewritePackage({ dir, version: "3.0.0", catalog: { yaml: "2.9.0" }, namedCatalogs: {} }).pipe(
        Effect.provide(makeStubLayer(files)),
        Effect.provideService(Console.Console, logger)
      )
    )

    return { logs, written: files.get(file) ?? "" }
  }

  it("writes tab-indented JSON and logs when a dep changed", () => {
    const r = run({ name: "a", dependencies: { "@konfig.ts/core": "workspace:*", yaml: "catalog:" } })
    expect(JSON.parse(r.written).dependencies).toEqual({ "@konfig.ts/core": "3.0.0", yaml: "2.9.0" })
    expect(r.written).toMatch(/^\{\n\t"name"/)
    expect(r.written.endsWith("}\n")).toBe(true)
    expect(r.logs).toEqual(["rewrote packages/a/package.json"])
  })
  it("leaves the file untouched when nothing changes", () => {
    const original = JSON.stringify({ name: "a", dependencies: { x: "^1.0.0" } })
    const r = run({ name: "a", dependencies: { x: "^1.0.0" } })
    expect(r.written).toBe(original)
    expect(r.logs).toEqual([])
  })
})
