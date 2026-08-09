import { Effect, Exit } from "effect"
import { describe, expect, it } from "vitest"
import type { DepRecord } from "./rewriteWorkspaceDeps"
import { _rewriteRecord } from "./rewriteWorkspaceDeps"

const _base = {
  catalog: { yaml: "2.9.0" } satisfies DepRecord,
  namedCatalogs: { test: { vitest: "4.1.10" } },
  pkgJsonPath: "packages/example/package.json"
}

describe("_rewriteRecord", () => {
  it("returns false and leaves an undefined record untouched", () => {
    const changed = Effect.runSync(_rewriteRecord({ ..._base, rec: undefined, version: "1.0.0" }))
    expect(changed).toBe(false)
  })

  it("resolves workspace:* / ^ / ~ for @konfig.ts/* deps to the given version", () => {
    const rec: DepRecord = {
      "@konfig.ts/core": "workspace:*",
      "@konfig.ts/k8s": "workspace:^",
      "@konfig.ts/env": "workspace:~"
    }
    const changed = Effect.runSync(_rewriteRecord({ ..._base, rec, version: "1.2.3" }))
    expect(changed).toBe(true)
    expect(rec["@konfig.ts/core"]).toBe("1.2.3")
    expect(rec["@konfig.ts/k8s"]).toBe("1.2.3")
    expect(rec["@konfig.ts/env"]).toBe("1.2.3")
  })

  it("resolves catalog: against the default catalog", () => {
    const rec: DepRecord = { yaml: "catalog:" }
    const changed = Effect.runSync(_rewriteRecord({ ..._base, rec, version: "1.0.0" }))
    expect(changed).toBe(true)
    expect(rec.yaml).toBe("2.9.0")
  })

  it("resolves catalog:<name> against the named catalog", () => {
    const rec: DepRecord = { vitest: "catalog:test" }
    const changed = Effect.runSync(_rewriteRecord({ ..._base, rec, version: "1.0.0" }))
    expect(changed).toBe(true)
    expect(rec.vitest).toBe("4.1.10")
  })

  it("leaves plain semver specs and non-@konfig.ts workspace deps unchanged", () => {
    const rec: DepRecord = { semver: "^1.0.0", "some-lib": "workspace:*" }
    const changed = Effect.runSync(_rewriteRecord({ ..._base, rec, version: "1.0.0" }))
    expect(changed).toBe(false)
    expect(rec.semver).toBe("^1.0.0")
    expect(rec["some-lib"]).toBe("workspace:*")
  })

  it("fails when a catalog: spec has no matching entry", () => {
    const rec: DepRecord = { missing: "catalog:" }
    const exit = Effect.runSyncExit(_rewriteRecord({ ..._base, rec, version: "1.0.0" }))
    expect(Exit.isFailure(exit)).toBe(true)
  })
})
