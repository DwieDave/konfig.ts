import { Console, Effect, Exit } from "effect"
import fc from "fast-check"
import { describe, expect, it } from "vitest"
import { REPO_ROOT } from "../lib/repo"
import { makeStubLayer } from "../lib/stubFs"
import type { DepRecord } from "./rewriteWorkspaceDeps"
import {
  _isWorkspaceSpec,
  _resolveCatalogSpec,
  _rewritePackage,
  caretRange,
  rewriteRecord
} from "./rewriteWorkspaceDeps"

const _base = {
  catalog: { yaml: "2.9.0" } satisfies DepRecord,
  namedCatalogs: { test: { vitest: "4.1.10" } },
  pkgJsonPath: "packages/example/package.json"
}

describe("rewriteRecord", () => {
  it("returns false and leaves an undefined record untouched", () => {
    const changed = Effect.runSync(rewriteRecord({ ..._base, rec: undefined, version: "1.0.0" }))
    expect(changed).toBe(false)
  })

  it("resolves workspace:* / ^ / ~ for @konfig.ts/* deps to the given version", () => {
    const rec: DepRecord = {
      "@konfig.ts/core": "workspace:*",
      "@konfig.ts/k8s": "workspace:^",
      "@konfig.ts/env": "workspace:~"
    }
    const changed = Effect.runSync(rewriteRecord({ ..._base, rec, version: "1.2.3" }))
    expect(changed).toBe(true)
    expect(rec["@konfig.ts/core"]).toBe("1.2.3")
    expect(rec["@konfig.ts/k8s"]).toBe("1.2.3")
    expect(rec["@konfig.ts/env"]).toBe("1.2.3")
  })
  it("resolves catalog: against the default catalog", () => {
    const rec: DepRecord = { yaml: "catalog:" }
    const changed = Effect.runSync(rewriteRecord({ ..._base, rec, version: "1.0.0" }))
    expect(changed).toBe(true)
    expect(rec.yaml).toBe("2.9.0")
  })

  it("resolves catalog:<name> against the named catalog", () => {
    const rec: DepRecord = { vitest: "catalog:test" }
    const changed = Effect.runSync(rewriteRecord({ ..._base, rec, version: "1.0.0" }))
    expect(changed).toBe(true)
    expect(rec.vitest).toBe("4.1.10")
  })

  it("emits a caret range for the effect family when the catalog pins an rc build", () => {
    const base = {
      ..._base,
      catalog: { effect: "4.0.0-rc.111", "@effect/platform-node": "4.0.0-rc.111", yaml: "2.9.0" }
    }
    const rec: DepRecord = { effect: "catalog:", "@effect/platform-node": "catalog:", yaml: "catalog:" }
    const changed = Effect.runSync(rewriteRecord({ ...base, rec, version: "1.0.0" }))
    expect(changed).toBe(true)
    expect(rec.effect).toBe("^4.0.0-rc.111")
    expect(rec["@effect/platform-node"]).toBe("^4.0.0-rc.111")
    expect(rec.yaml).toBe("2.9.0")
  })

  it("emits a caret range for the effect family when the catalog pins a stable build", () => {
    const base = { ..._base, catalog: { effect: "4.0.5", "@effect/platform-node": "4.0.5", yaml: "2.9.0" } }
    const rec: DepRecord = { effect: "catalog:", "@effect/platform-node": "catalog:", yaml: "catalog:" }
    const changed = Effect.runSync(rewriteRecord({ ...base, rec, version: "1.0.0" }))
    expect(changed).toBe(true)
    expect(rec.effect).toBe("^4.0.5")
    expect(rec["@effect/platform-node"]).toBe("^4.0.5")
    expect(rec.yaml).toBe("2.9.0")
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

  it("leaves plain semver specs and non-@konfig.ts workspace deps unchanged", () => {
    const rec: DepRecord = { semver: "^1.0.0", "some-lib": "workspace:*" }
    const changed = Effect.runSync(rewriteRecord({ ..._base, rec, version: "1.0.0" }))
    expect(changed).toBe(false)
    expect(rec.semver).toBe("^1.0.0")
    expect(rec["some-lib"]).toBe("workspace:*")
  })

  it("fails when a catalog: spec has no matching entry", () => {
    const rec: DepRecord = { missing: "catalog:" }
    const exit = Effect.runSyncExit(rewriteRecord({ ..._base, rec, version: "1.0.0" }))
    expect(Exit.isFailure(exit)).toBe(true)
  })
})

describe("_isWorkspaceSpec", () => {
  it("accepts only @konfig.ts names with workspace:* ^ ~", () => {
    fc.assert(fc.property(fc.string(), fc.constantFrom("*", "^", "~", "1.0.0"), (suffix, tail) => {
      const spec = `workspace:${tail}`
      expect(_isWorkspaceSpec({ name: `@konfig.ts/${suffix}`, spec })).toBe(tail !== "1.0.0")
      expect(_isWorkspaceSpec({ name: `other/${suffix}`, spec })).toBe(false)
    }))
  })
})

describe("_resolveCatalogSpec", () => {
  const input = (name: string, spec: string) => ({
    ..._base,
    catalog: { effect: "4.0.5", yaml: "2.9.0" },
    rec: undefined,
    version: "1.0.0",
    name,
    spec
  })
  it("resolves default, named, and effect-family caret", () => {
    expect(Effect.runSync(_resolveCatalogSpec(input("yaml", "catalog:")))).toBe("2.9.0")
    expect(Effect.runSync(_resolveCatalogSpec(input("vitest", "catalog:test")))).toBe("4.1.10")
    expect(Effect.runSync(_resolveCatalogSpec(input("effect", "catalog:")))).toBe("^4.0.5")
  })
  it("fails on missing default and missing named catalogs", () => {
    expect(Exit.isFailure(Effect.runSyncExit(_resolveCatalogSpec(input("nope", "catalog:"))))).toBe(true)
    expect(Exit.isFailure(Effect.runSyncExit(_resolveCatalogSpec(input("yaml", "catalog:ghost"))))).toBe(true)
  })
})

describe("_rewritePackage", () => {
  const dir = `${REPO_ROOT}packages/a`
  const file = `${dir}/package.json`
  const run = (pkg: Record<string, unknown>) => {
    const files = new Map([[file, JSON.stringify(pkg)]])
    const logs: Array<string> = []
    const logger = { ...console, log: (m: string) => void logs.push(m) }
    Effect.runSync(
      _rewritePackage({ dir, version: "3.0.0", catalog: { yaml: "2.9.0" }, namedCatalogs: {} }).pipe(
        Effect.provide(makeStubLayer(files)),
        Effect.provideService(Console.Console, logger as Console.Console)
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
