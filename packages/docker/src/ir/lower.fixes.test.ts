import { NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Effect } from "effect"
import { describe, expect } from "vitest"
import { BuildAtom, CopyAtom, PackageManagerAtom, RuntimeAtom } from "../spec"
import type { DockerSpec } from "../spec"
import { pkgJson, rootPkgJson, writeTree } from "../testing/tree"
import { type DockerfileBundle, Instr, type Stage } from "./DockerfileIR"
import { copiesOf, requireStage, runsOf } from "./irTesting"
import { lower, type LowerInput } from "./lower"

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

const specFor = (dir: string, over: Partial<DockerSpec> = {}): LowerInput => ({
  target: `${dir}/packages/app`,
  spec: {
    runner: { workdir: "/app/packages/app", copy: [CopyAtom.cases.WorkspaceSourceAll.make({})], cmd: ["node", "x.js"] },
    ...over
  }
})

const stage = (b: DockerfileBundle, name: string): Stage => requireStage({ bundle: b, name })

const copySrcs = (s: Stage): ReadonlyArray<string> => copiesOf(s).flatMap((i) => i.src)

const runCmds = (s: Stage): ReadonlyArray<string> => runsOf(s).map((i) => i.cmd)

describe("lower fixes", () => {
  it.effect("copies only aux files that exist, and npm closure follows semver deps", () =>
    Effect.gen(function*() {
      const dir = yield* writeTree({ ...baseFiles, ".npmrc": "x" })
      const b = yield* lower(specFor(dir))
      const deps = stage(b, "deps")
      expect(deps.instructions.find(Instr.$is("Copy"))).toMatchObject({
        src: ["package.json", "package-lock.json", ".npmrc"]
      })
      expect(copySrcs(stage(b, "runner"))).toContain("/app/packages/util")
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("omits aux files that do not exist", () =>
    Effect.gen(function*() {
      const dir = yield* writeTree(baseFiles)
      const b = yield* lower(specFor(dir))
      expect(stage(b, "deps").instructions.find(Instr.$is("Copy"))).toMatchObject({
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

      const fromDeps = copiesOf(stage(b, "builder")).filter((i) => i.from === "deps").flatMap((i) => i.src)

      expect(fromDeps).toContain("/app/packages/util/node_modules")
      expect(fromDeps).not.toContain("/app/packages/tsconfig/node_modules")
      expect(copySrcs(stage(b, "builder"))).toContain("packages/tsconfig")
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("uses Debian user commands for non-alpine runtime", () =>
    Effect.gen(function*() {
      const dir = yield* writeTree(baseFiles)
      const b = yield* lower(specFor(dir, { runtime: RuntimeAtom.cases.NodeRuntime.make({ alpine: false }) }))
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
        spec: { ...spec.spec, runner: { ...spec.spec.runner, baseImage: { image: "debian", tag: "12-slim" } } }
      })

      expect(runCmds(stage(b, "runner"))[0]).toContain("useradd")
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("picks lockfile of the overriding package manager", () =>
    Effect.gen(function*() {
      const dir = yield* writeTree({ ...baseFiles, "pnpm-lock.yaml": "x" })
      const b = yield* lower(specFor(dir, { packageManager: PackageManagerAtom.cases.PnpmPm.make({}) }))
      expect(stage(b, "deps").instructions.find(Instr.$is("Copy"))).toMatchObject({
        src: ["package.json", "pnpm-lock.yaml"]
      })
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("BuildCommand argv keeps quoting", () =>
    Effect.gen(function*() {
      const dir = yield* writeTree(baseFiles)

      const build = BuildAtom.cases.BuildCommand.make({ argv: ["sh", "-c", "echo $HOME && ls"] })
      const b = yield* lower(specFor(dir, { build }))

      expect(runCmds(stage(b, "builder")).at(-1)).toBe("sh -c 'echo $HOME && ls'")
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))
})
