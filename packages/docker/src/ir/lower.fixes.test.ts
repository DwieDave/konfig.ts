import { NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Effect } from "effect"
import { describe, expect } from "vitest"
import type { DockerSpec } from "../spec"
import { pkgJson, rootPkgJson, writeTree } from "../testing/tree"
import type { Instruction, Stage } from "./DockerfileIR"
import { lower } from "./lower"

const engines = { engines: { node: "22.0.0", npm: "10.5.0", pnpm: "9.0.0", bun: "1.3.5" } }

const baseFiles = {
  "package.json": rootPkgJson({ workspaces: ["packages/*"], extra: { packageManager: "npm@10.5.0" } }),
  "package-lock.json": "{}",
  "packages/app/package.json": pkgJson({
    name: "app",
    extra: {
      ...engines,
      dependencies: { util: "^1.0.0" },
      devDependencies: { tsconfig: "^1.0.0" }
    }
  }),
  "packages/util/package.json": pkgJson({ name: "util" }),
  "packages/tsconfig/package.json": pkgJson({ name: "tsconfig" })
}

const specFor = (dir: string, over: Partial<DockerSpec> = {}): DockerSpec => ({
  target: `${dir}/packages/app`,
  runner: { workdir: "/app/packages/app", copy: [{ _tag: "WorkspaceSourceAll" }], cmd: ["node", "x.js"] },
  ...over
})

const stage = (b: { prod: { stages: ReadonlyArray<Stage> } }, name: string): Stage =>
  b.prod.stages.find((s) => s.name === name)!

const copySrcs = (s: Stage): ReadonlyArray<string> =>
  s.instructions.flatMap((i: Instruction) => (i._tag === "Copy" ? i.src : []))

const runCmds = (s: Stage): ReadonlyArray<string> => s.instructions.flatMap((i) => (i._tag === "Run" ? [i.cmd] : []))

describe("lower fixes", () => {
  it.effect("copies only aux files that exist, and npm closure follows semver deps", () =>
    Effect.gen(function*() {
      const dir = yield* writeTree({ ...baseFiles, ".npmrc": "x" })
      const b = yield* lower(specFor(dir))
      const deps = stage(b, "deps")
      expect(deps.instructions.find((i) => i._tag === "Copy")).toMatchObject({
        src: ["package.json", "package-lock.json", ".npmrc"]
      })
      expect(copySrcs(stage(b, "runner"))).toContain("/app/packages/util")
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("omits aux files that do not exist", () =>
    Effect.gen(function*() {
      const dir = yield* writeTree(baseFiles)
      const b = yield* lower(specFor(dir))
      expect(stage(b, "deps").instructions.find((i) => i._tag === "Copy")).toMatchObject({
        src: ["package.json", "package-lock.json"]
      })
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("builder copies workspace devDependencies but runner closure does not", () =>
    Effect.gen(function*() {
      const dir = yield* writeTree(baseFiles)
      const b = yield* lower(specFor(dir))
      expect(copySrcs(stage(b, "builder"))).toContain("packages/tsconfig")
      expect(copySrcs(stage(b, "runner"))).not.toContain("/app/packages/tsconfig")
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("builder only copies deps node_modules for the runtime closure", () =>
    Effect.gen(function*() {
      const dir = yield* writeTree({
        ...baseFiles,
        "package.json": rootPkgJson({ workspaces: ["packages/*"], extra: { packageManager: "bun@1.3.5" } }),
        "bun.lock": "{}"
      })
      const b = yield* lower(specFor(dir))
      const fromDeps = stage(b, "builder").instructions.flatMap((i) =>
        i._tag === "Copy" && i.from === "deps" ? i.src : []
      )
      expect(fromDeps).toContain("/app/packages/util/node_modules")
      expect(fromDeps).not.toContain("/app/packages/tsconfig/node_modules")
      expect(copySrcs(stage(b, "builder"))).toContain("packages/tsconfig")
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("uses Debian user commands for non-alpine runtime", () =>
    Effect.gen(function*() {
      const dir = yield* writeTree(baseFiles)
      const b = yield* lower(specFor(dir, { runtime: { _tag: "NodeRuntime", alpine: false } }))
      const cmd = runCmds(stage(b, "runner"))[0]!
      expect(cmd).toContain("useradd")
      expect(cmd).not.toContain("adduser -S")
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("uses Debian user commands for a non-alpine custom baseImage", () =>
    Effect.gen(function*() {
      const dir = yield* writeTree(baseFiles)
      const spec = specFor(dir)
      const b = yield* lower({
        ...spec,
        runner: { ...spec.runner, baseImage: { image: "debian", tag: "12-slim" } }
      })
      expect(runCmds(stage(b, "runner"))[0]).toContain("useradd")
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("picks lockfile of the overriding package manager", () =>
    Effect.gen(function*() {
      const dir = yield* writeTree({ ...baseFiles, "pnpm-lock.yaml": "x" })
      const b = yield* lower(specFor(dir, { packageManager: { _tag: "PnpmPm" } }))
      expect(stage(b, "deps").instructions.find((i) => i._tag === "Copy")).toMatchObject({
        src: ["package.json", "pnpm-lock.yaml"]
      })
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("BuildCommand argv keeps quoting", () =>
    Effect.gen(function*() {
      const dir = yield* writeTree(baseFiles)
      const b = yield* lower(specFor(dir, { build: { _tag: "BuildCommand", argv: ["sh", "-c", "echo $HOME && ls"] } }))
      expect(runCmds(stage(b, "builder")).at(-1)).toBe("sh -c 'echo $HOME && ls'")
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))
})
