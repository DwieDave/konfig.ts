import { NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Effect, Exit } from "effect"
import * as fc from "fast-check"
import { describe, expect } from "vitest"
import { type Files, pkgJson as pkg, rootPkgJson as rootPkg, writeTree } from "../testing/tree"
import { allWorkspaces, closureOf, findRoot, type Workspace } from "./WorkspaceGraph"

const relDirsOf = (files: Files) =>
  Effect.gen(function*() {
    const dir = yield* writeTree(files)
    const root = yield* findRoot(dir)
    return (yield* allWorkspaces(root)).map((w) => w.relDir)
  })

describe("workspace globs", () => {
  it.effect("supports partial-segment patterns like web-*", () =>
    Effect.gen(function*() {
      const dirs = yield* relDirsOf({
        "package.json": rootPkg({ workspaces: ["apps/web-*"] }),
        "apps/web-a/package.json": pkg({ name: "a" }),
        "apps/web-b/package.json": pkg({ name: "b" }),
        "apps/api/package.json": pkg({ name: "c" })
      })
      expect(dirs).toEqual(["apps/web-a", "apps/web-b"])
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("supports negated patterns", () =>
    Effect.gen(function*() {
      const dirs = yield* relDirsOf({
        "package.json": rootPkg({ workspaces: ["packages/*", "!packages/legacy"] }),
        "packages/a/package.json": pkg({ name: "a" }),
        "packages/legacy/package.json": pkg({ name: "legacy" })
      })
      expect(dirs).toEqual(["packages/a"])
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("negation with ** excludes nested matches", () =>
    Effect.gen(function*() {
      const dirs = yield* relDirsOf({
        "package.json": rootPkg({ workspaces: ["packages/**", "!**/test/**"] }),
        "packages/a/package.json": pkg({ name: "a" }),
        "packages/a/test/fixture/package.json": pkg({ name: "fx" })
      })
      expect(dirs).toEqual(["packages/a"])
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))
})

describe("malformed package.json", () => {
  it.effect("fails with PackageJsonInvalid naming the workspace file", () =>
    Effect.gen(function*() {
      const dir = yield* writeTree({
        "package.json": rootPkg({ workspaces: ["packages/*"] }),
        "packages/a/package.json": "{ not json"
      })
      const root = yield* findRoot(dir)
      const err = yield* Effect.flip(allWorkspaces(root))
      expect(err._tag).toBe("PackageJsonInvalid")
      expect(err.path.endsWith("packages/a/package.json")).toBe(true)
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))
})

const ws = (name: string, pkgFields: object): Workspace => ({
  name,
  relDir: `packages/${name}`,
  pkg: { name, ...pkgFields },
  hasBuildScript: false
})

const range = fc.constantFrom("^1.0.0", "1.2.3", "~2.0.0", "*", "workspace:*", "link:../x", ">=1")

describe("closureOf protocol-agnostic", () => {
  it("follows workspace deps whatever the version range is", () => {
    fc.assert(
      fc.property(range, range, (r1, r2) => {
        const all = [
          ws("app", { dependencies: { util: r1 } }),
          ws("util", { dependencies: { shared: r2, external: "^1.0.0" } }),
          ws("shared", {})
        ]
        const result = Effect.runSyncExit(closureOf({ all, target: "app" }))
        expect(Exit.isSuccess(result) && result.value.map((w) => w.name)).toEqual(["shared", "util", "app"])
      })
    )
  })

  it("devDependencies join only the build closure", () => {
    const all = [ws("app", { devDependencies: { tsconfig: "^1.0.0" } }), ws("tsconfig", {})]
    const run = (includeDev: boolean) => {
      const r = Effect.runSyncExit(closureOf({ all, target: "app", includeDev }))
      return Exit.isSuccess(r) ? r.value.map((w) => w.name) : []
    }
    expect(run(false)).toEqual(["app"])
    expect(run(true)).toEqual(["tsconfig", "app"])
  })
})
