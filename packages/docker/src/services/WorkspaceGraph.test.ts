import { NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Effect, Exit } from "effect"
import { describe, expect } from "vitest"
import { CircularWorkspaceDep, WorkspaceNotFound } from "../DockerError"
import { allWorkspaces, closureOf, detectPm, findRoot, type Workspace } from "./WorkspaceGraph"

const FIXTURES = new URL("../../fixtures/", import.meta.url).pathname

const provided = <A, E>(eff: Effect.Effect<A, E, never>) => eff
const withFs = <A, E>(eff: Effect.Effect<A, E, ReturnType<typeof Effect.gen>>) =>
  Effect.provide(eff, NodeServices.layer)

describe("findRoot", () => {
  it.effect("returns the bun fixture root when started from a nested workspace", () =>
    Effect.gen(function*() {
      const root = yield* findRoot(`${FIXTURES}bun/packages/app`)
      expect(root.endsWith("/fixtures/bun")).toBe(true)
    }).pipe(Effect.provide(NodeServices.layer)))

  it.effect("returns the pnpm-isolated root from packages/util (pnpm-workspace.yaml signals root)", () =>
    Effect.gen(function*() {
      const root = yield* findRoot(`${FIXTURES}pnpm-isolated/packages/util`)
      expect(root.endsWith("/fixtures/pnpm-isolated")).toBe(true)
    }).pipe(Effect.provide(NodeServices.layer)))

  it.effect("fails MonorepoRootNotFound when no workspaces field anywhere up the tree", () =>
    Effect.gen(function*() {
      const exit = yield* Effect.exit(findRoot("/etc"))
      expect(Exit.isFailure(exit)).toBe(true)
    }).pipe(Effect.provide(NodeServices.layer)))
})

const expectWorkspacesEqual = (
  out: ReadonlyArray<Workspace>,
  expected: ReadonlyArray<{ name: string; relDir: string; hasBuild: boolean }>
): void => {
  expect(out.map((w) => ({ name: w.name, relDir: w.relDir, hasBuild: w.hasBuildScript }))).toEqual(
    expected
  )
}

describe("allWorkspaces", () => {
  it.effect("bun fixture: returns all 4 workspaces sorted by name", () =>
    Effect.gen(function*() {
      const root = yield* findRoot(`${FIXTURES}bun`)
      const ws = yield* allWorkspaces(root)
      expectWorkspacesEqual(ws, [
        { name: "@fix/app", relDir: "packages/app", hasBuild: true },
        { name: "@fix/other", relDir: "packages/other", hasBuild: false },
        { name: "@fix/shared", relDir: "packages/shared", hasBuild: false },
        { name: "@fix/util", relDir: "packages/util", hasBuild: false }
      ])
    }).pipe(Effect.provide(NodeServices.layer)))

  it.effect("nested-glob fixture: `packages/**` recursively descends into nested workspaces", () =>
    Effect.gen(function*() {
      const root = yield* findRoot(`${FIXTURES}nested-glob`)
      const ws = yield* allWorkspaces(root)
      // `packages/a` (one level) and `packages/group/b` (two levels) are
      // both reachable only via recursive `**` descent. Before the fix
      // `**` failed and orElseSucceed swallowed it to zero workspaces.
      expect(ws.map((w) => ({ name: w.name, relDir: w.relDir }))).toEqual([
        { name: "@fix/a", relDir: "packages/a" },
        { name: "@fix/b", relDir: "packages/group/b" }
      ])
    }).pipe(Effect.provide(NodeServices.layer)))

  it.effect("pnpm-isolated fixture: parses workspaces from pnpm-workspace.yaml", () =>
    Effect.gen(function*() {
      const root = yield* findRoot(`${FIXTURES}pnpm-isolated`)
      const ws = yield* allWorkspaces(root)
      expect(ws.map((w) => w.name)).toEqual([
        "@fix/app",
        "@fix/other",
        "@fix/shared",
        "@fix/util"
      ])
    }).pipe(Effect.provide(NodeServices.layer)))
})

describe("detectPm", () => {
  it.effect("bun fixture: kind=Bun, version=1.3.5 from packageManager field", () =>
    Effect.gen(function*() {
      const root = yield* findRoot(`${FIXTURES}bun`)
      const pm = yield* detectPm(root)
      expect(pm.kind).toBe("Bun")
      expect(pm.version).toBe("1.3.5")
      expect(pm.pnpmLayout).toBeUndefined()
    }).pipe(Effect.provide(NodeServices.layer)))

  it.effect("npm fixture", () =>
    Effect.gen(function*() {
      const root = yield* findRoot(`${FIXTURES}npm`)
      const pm = yield* detectPm(root)
      expect(pm.kind).toBe("Npm")
      expect(pm.version).toBe("10.5.0")
    }).pipe(Effect.provide(NodeServices.layer)))

  it.effect("pnpm-isolated: layout=isolated", () =>
    Effect.gen(function*() {
      const root = yield* findRoot(`${FIXTURES}pnpm-isolated`)
      const pm = yield* detectPm(root)
      expect(pm.kind).toBe("Pnpm")
      expect(pm.version).toBe("9.7.0")
      expect(pm.pnpmLayout).toBe("isolated")
    }).pipe(Effect.provide(NodeServices.layer)))

  it.effect("pnpm-hoisted: layout=hoisted detected from .npmrc", () =>
    Effect.gen(function*() {
      const root = yield* findRoot(`${FIXTURES}pnpm-hoisted`)
      const pm = yield* detectPm(root)
      expect(pm.kind).toBe("Pnpm")
      expect(pm.pnpmLayout).toBe("hoisted")
    }).pipe(Effect.provide(NodeServices.layer)))

  it.effect("yarn-classic: kind=Yarn, variant=classic from yarn@1 corepack pin", () =>
    Effect.gen(function*() {
      const root = yield* findRoot(`${FIXTURES}yarn-classic`)
      const pm = yield* detectPm(root)
      expect(pm.kind).toBe("Yarn")
      expect(pm.version).toBe("1.22.22")
      expect(pm.yarnVariant).toBe("classic")
    }).pipe(Effect.provide(NodeServices.layer)))

  it.effect("yarn-berry: variant=berry from yarn@4 corepack pin + .yarnrc.yml", () =>
    Effect.gen(function*() {
      const root = yield* findRoot(`${FIXTURES}yarn-berry`)
      const pm = yield* detectPm(root)
      expect(pm.kind).toBe("Yarn")
      expect(pm.version).toBe("4.5.0")
      expect(pm.yarnVariant).toBe("berry")
    }).pipe(Effect.provide(NodeServices.layer)))
})

describe("closureOf", () => {
  const _ws = (name: string, deps: Record<string, string> = {}): Workspace => ({
    name,
    relDir: `packages/${name.split("/")[1]}`,
    pkg: { name, dependencies: deps },
    hasBuildScript: false
  })

  it.effect("returns dep-first topological closure for the bun fixture's @fix/app", () =>
    Effect.gen(function*() {
      const root = yield* findRoot(`${FIXTURES}bun`)
      const all = yield* allWorkspaces(root)
      const closure = yield* closureOf({ all, target: "@fix/app" })
      expect(closure.map((w) => w.name)).toEqual(["@fix/shared", "@fix/util", "@fix/app"])
    }).pipe(Effect.provide(NodeServices.layer)))

  it.effect("returns a single-element closure when target has no workspace deps", () =>
    Effect.gen(function*() {
      const root = yield* findRoot(`${FIXTURES}bun`)
      const all = yield* allWorkspaces(root)
      const closure = yield* closureOf({ all, target: "@fix/shared" })
      expect(closure.map((w) => w.name)).toEqual(["@fix/shared"])
    }).pipe(Effect.provide(NodeServices.layer)))

  it("WorkspaceNotFound when target is unknown", async () => {
    const all: ReadonlyArray<Workspace> = [_ws("@a", {})]
    const exit = await Effect.runPromiseExit(closureOf({ all, target: "@missing" }))
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const cause = exit.cause
      const isWNF = JSON.stringify(cause).includes("WorkspaceNotFound")
      expect(isWNF).toBe(true)
    }
  })

  it("detects a cycle", async () => {
    const a = _ws("@a", { "@b": "workspace:*" })
    const b = _ws("@b", { "@a": "workspace:*" })
    const exit = await Effect.runPromiseExit(closureOf({ all: [a, b], target: "@a" }))
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const isCycle = JSON.stringify(exit.cause).includes("CircularWorkspaceDep")
      expect(isCycle).toBe(true)
    }
  })

  it.effect("looks up targets by relDir as well as name", () =>
    Effect.gen(function*() {
      const root = yield* findRoot(`${FIXTURES}bun`)
      const all = yield* allWorkspaces(root)
      const closure = yield* closureOf({ all, target: "packages/app" })
      expect(closure.map((w) => w.name)).toEqual(["@fix/shared", "@fix/util", "@fix/app"])
    }).pipe(Effect.provide(NodeServices.layer)))
})

void provided
void withFs
void WorkspaceNotFound
void CircularWorkspaceDep
