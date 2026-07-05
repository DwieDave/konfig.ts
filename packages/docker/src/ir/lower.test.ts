import { NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Effect, Exit } from "effect"
import { describe, expect } from "vitest"
import type { DockerSpec } from "../spec"
import { lower } from "./lower"

const FIXTURES = new URL("../../fixtures/", import.meta.url).pathname

const minimalSpec = (target: string): DockerSpec => ({
  target,
  runner: {
    workdir: "/app/packages/app",
    copy: [{ _tag: "BuilderArtifact", src: "dist", dst: "dist" }],
    cmd: ["bun", "run", "dist/main.js"]
  }
})

describe("lower (bun fixture)", () => {
  it.effect("emits prod bundle with deps/builder/runner from base", () =>
    Effect.gen(function*() {
      const bundle = yield* lower(minimalSpec(`${FIXTURES}bun/packages/app`))
      expect(bundle.prod.stages.map((s) => s.name)).toEqual([
        "base",
        "deps",
        "builder",
        "runner"
      ])
      expect(bundle.dev).toBeUndefined()
    }).pipe(Effect.provide(NodeServices.layer)))

  it.effect("base stage uses runtime image from engines.bun", () =>
    Effect.gen(function*() {
      const bundle = yield* lower(minimalSpec(`${FIXTURES}bun/packages/app`))
      const base = bundle.prod.stages[0]!
      expect(base.from).toEqual({ _tag: "FromImage", image: "oven/bun", tag: "1.3.5-alpine" })
    }).pipe(Effect.provide(NodeServices.layer)))

  it.effect("deps stage COPYs every workspace package.json (not just closure)", () =>
    Effect.gen(function*() {
      const bundle = yield* lower(minimalSpec(`${FIXTURES}bun/packages/app`))
      const deps = bundle.prod.stages.find((s) => s.name === "deps")!
      const copies = deps.instructions.filter((i) => i._tag === "Copy")
      const pkgJsonCopies = copies.filter((c) =>
        (c as { src: ReadonlyArray<string> }).src.some((s) => s.endsWith("/package.json"))
      )
      expect(pkgJsonCopies.length).toBe(4)
    }).pipe(Effect.provide(NodeServices.layer)))

  it.effect("builder stage COPYs only closure node_modules (AC-2/AC-8)", () =>
    Effect.gen(function*() {
      const bundle = yield* lower(minimalSpec(`${FIXTURES}bun/packages/app`))
      const builder = bundle.prod.stages.find((s) => s.name === "builder")!
      const nodeModulesCopies = builder.instructions.filter(
        (i) =>
          i._tag === "Copy" &&
          (i as { src: ReadonlyArray<string> }).src.some((s) => s.endsWith("/node_modules"))
      )
      // Root + 3 closure members (@fix/shared, @fix/util, @fix/app)
      expect(nodeModulesCopies.length).toBe(4)
      const allDsts = nodeModulesCopies.map((c) => (c as { dst: string }).dst)
      expect(allDsts).not.toContain("/app/packages/other/node_modules")
    }).pipe(Effect.provide(NodeServices.layer)))

  it.effect("runner stage injects USER nonRoot (uid 1001) and NODE_ENV=production by default (AC-8)", () =>
    Effect.gen(function*() {
      const bundle = yield* lower(minimalSpec(`${FIXTURES}bun/packages/app`))
      const runner = bundle.prod.stages.find((s) => s.name === "runner")!
      const userInstr = runner.instructions.find((i) => i._tag === "User")
      expect(userInstr).toBeDefined()
      const envInstr = runner.instructions.find((i) => i._tag === "Env")
      expect(envInstr).toBeDefined()
      const entries = (envInstr as { entries: ReadonlyArray<readonly [string, string]> }).entries
      expect(entries.find(([k]) => k === "NODE_ENV")?.[1]).toBe("production")
      const runs = runner.instructions.filter((i) => i._tag === "Run")
      expect(runs.length).toBeGreaterThanOrEqual(1)
      expect((runs[0] as { cmd: string }).cmd).toContain("adduser")
    }).pipe(Effect.provide(NodeServices.layer)))

  it.effect("dev stage is emitted only when spec.dev is set", () =>
    Effect.gen(function*() {
      const specWithDev: DockerSpec = {
        ...minimalSpec(`${FIXTURES}bun/packages/app`),
        dev: { cmd: ["bun", "--watch", "main.ts"] }
      }
      const bundle = yield* lower(specWithDev)
      expect(bundle.dev).toBeDefined()
      expect(bundle.dev?.stages.map((s) => s.name)).toEqual(["base", "dev"])
    }).pipe(Effect.provide(NodeServices.layer)))

  it.effect("dev stage copies sharedRootFiles like the builder stage does", () =>
    Effect.gen(function*() {
      const spec: DockerSpec = {
        ...minimalSpec(`${FIXTURES}bun/packages/app`),
        sharedRootFiles: ["tsconfig.base.json"],
        dev: { cmd: ["bun", "--watch", "main.ts"] }
      }
      const bundle = yield* lower(spec)
      const dev = bundle.dev?.stages.find((s) => s.name === "dev")
      expect(dev).toBeDefined()
      const sharedCopies = (dev?.instructions ?? []).filter(
        (i) =>
          i._tag === "Copy" &&
          (i as { src: ReadonlyArray<string> }).src.includes("tsconfig.base.json")
      )
      expect(sharedCopies.length).toBe(1)
    }).pipe(Effect.provide(NodeServices.layer)))

  it.effect("workspaceSourceAll expands to per-workspace COPYs (excluding target)", () =>
    Effect.gen(function*() {
      const spec: DockerSpec = {
        ...minimalSpec(`${FIXTURES}bun/packages/app`),
        runner: {
          workdir: "/app/packages/app",
          copy: [{ _tag: "WorkspaceSourceAll" }],
          cmd: ["bun", "run", "main.ts"]
        }
      }
      const bundle = yield* lower(spec)
      const runner = bundle.prod.stages.find((s) => s.name === "runner")!
      const wsCopies = runner.instructions.filter(
        (i) =>
          i._tag === "Copy" &&
          (i as { src: ReadonlyArray<string> }).src.some(
            (s) => s.startsWith("/app/packages/") && !s.endsWith("/node_modules")
          )
      )
      // Closure has shared, util, app — workspaceSourceAll excludes target (app), so 2 entries.
      expect(wsCopies.length).toBe(2)
    }).pipe(Effect.provide(NodeServices.layer)))

  it.effect("isolated linker copies each closure workspace's node_modules (incl. target) from the deps stage", () =>
    Effect.gen(function*() {
      const spec: DockerSpec = {
        ...minimalSpec(`${FIXTURES}bun/packages/app`),
        runner: {
          workdir: "/app/packages/app",
          production: true,
          copy: [{ _tag: "WorkspaceSourceAll" }],
          cmd: ["bun", "run", "main.ts"]
        }
      }
      const bundle = yield* lower(spec)
      const runner = bundle.prod.stages.find((s) => s.name === "runner")!
      const nmCopies = runner.instructions.filter(
        (i) =>
          i._tag === "Copy" &&
          (i as { src: ReadonlyArray<string> }).src.some((s) => s.endsWith("/node_modules"))
      ) as ReadonlyArray<{ from?: string; src: ReadonlyArray<string> }>
      // root + every closure workspace (shared, util, app/target) = 4.
      expect(nmCopies.length).toBe(4)
      // All sourced from the production deps stage, never the dev builder.
      expect(nmCopies.every((c) => c.from === "prod-deps")).toBe(true)
      // The target app's own node_modules is included (the bug this guards).
      expect(
        nmCopies.some((c) => c.src.includes("/app/packages/app/node_modules"))
      ).toBe(true)
    }).pipe(Effect.provide(NodeServices.layer)))

  it.effect("removePaths emits one robustly-escaped `rm -rf` line per path", () =>
    Effect.gen(function*() {
      const base = minimalSpec(`${FIXTURES}bun/packages/app`)
      const spec: DockerSpec = {
        ...base,
        runner: {
          ...base.runner,
          production: true,
          removePaths: [
            "node_modules/sharp",
            "node_modules/@types/react dom",
            "node_modules/x'; rm -rf /",
            "node_modules/$(whoami)"
          ]
        }
      }
      const bundle = yield* lower(spec)
      const stage = bundle.prod.stages.find((s) => s.name === "prod-deps")!
      const rmRuns = stage.instructions.filter(
        (i) => i._tag === "Run" && (i as { cmd: string }).cmd.startsWith("rm -rf ")
      ) as ReadonlyArray<{ cmd: string }>
      // One line per path (the old code joined every path into a single line).
      expect(rmRuns.length).toBe(4)
      // Each token single-quoted; spaces, metacharacters and embedded
      // single quotes are neutralised (the embedded quote uses '\'').
      expect(rmRuns.map((r) => r.cmd)).toEqual([
        `rm -rf 'node_modules/sharp'`,
        `rm -rf 'node_modules/@types/react dom'`,
        `rm -rf 'node_modules/x'\\''; rm -rf /'`,
        `rm -rf 'node_modules/$(whoami)'`
      ])
    }).pipe(Effect.provide(NodeServices.layer)))

  it.effect("user-supplied env is sorted alphabetically and NODE_ENV not overridden", () =>
    Effect.gen(function*() {
      const spec: DockerSpec = {
        ...minimalSpec(`${FIXTURES}bun/packages/app`),
        runner: {
          ...minimalSpec(`${FIXTURES}bun/packages/app`).runner,
          env: { ZED: "9", ABE: "1", NODE_ENV: "staging" }
        }
      }
      const bundle = yield* lower(spec)
      const runner = bundle.prod.stages.find((s) => s.name === "runner")!
      const env = runner.instructions.find((i) => i._tag === "Env") as
        | { entries: ReadonlyArray<readonly [string, string]> }
        | undefined
      expect(env?.entries.map(([k]) => k)).toEqual(["ABE", "NODE_ENV", "ZED"])
      expect(env?.entries.find(([k]) => k === "NODE_ENV")?.[1]).toBe("staging")
    }).pipe(Effect.provide(NodeServices.layer)))
})

describe("lower error paths", () => {
  it.effect("fails BuildScriptMissing when spec asks for a script the target doesn't have", () =>
    Effect.gen(function*() {
      const spec: DockerSpec = {
        ...minimalSpec(`${FIXTURES}bun/packages/app`),
        build: { _tag: "BuildScript", script: "nope" }
      }
      const exit = yield* Effect.exit(lower(spec))
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        expect(JSON.stringify(exit.cause)).toContain("BuildScriptMissing")
      }
    }).pipe(Effect.provide(NodeServices.layer)))

  it.effect("fails WorkspaceSourceUnknown for a workspace not in closure", () =>
    Effect.gen(function*() {
      const spec: DockerSpec = {
        ...minimalSpec(`${FIXTURES}bun/packages/app`),
        runner: {
          workdir: "/app/packages/app",
          copy: [{ _tag: "WorkspaceSource", name: "@fix/other" }],
          cmd: ["bun", "run", "main.ts"]
        }
      }
      const exit = yield* Effect.exit(lower(spec))
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        expect(JSON.stringify(exit.cause)).toContain("WorkspaceSourceUnknown")
      }
    }).pipe(Effect.provide(NodeServices.layer)))

  it.effect("fails SharedRootFileMissing for a missing shared file", () =>
    Effect.gen(function*() {
      const spec: DockerSpec = {
        ...minimalSpec(`${FIXTURES}bun/packages/app`),
        sharedRootFiles: ["no-such-file.json"]
      }
      const exit = yield* Effect.exit(lower(spec))
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        expect(JSON.stringify(exit.cause)).toContain("SharedRootFileMissing")
      }
    }).pipe(Effect.provide(NodeServices.layer)))

  it.effect("fails EngineVersionMissing when target has no engines.<runtime>", () =>
    Effect.gen(function*() {
      // shared has no engines field
      const spec: DockerSpec = {
        target: `${FIXTURES}bun/packages/shared`,
        runner: {
          workdir: "/app/packages/shared",
          copy: [],
          cmd: ["bun", "run", "main.ts"]
        }
      }
      const exit = yield* Effect.exit(lower(spec))
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        expect(JSON.stringify(exit.cause)).toContain("EngineVersionMissing")
      }
    }).pipe(Effect.provide(NodeServices.layer)))
})

describe("lower prod-deps stage (production install per package manager)", () => {
  const cases = [
    { pm: "bun", target: `${FIXTURES}bun/packages/app`, lockfile: "bun.lock" },
    { pm: "npm", target: `${FIXTURES}npm/packages/app`, lockfile: "package-lock.json" },
    { pm: "pnpm", target: `${FIXTURES}pnpm-isolated/packages/app`, lockfile: "pnpm-lock.yaml" },
    { pm: "yarn", target: `${FIXTURES}yarn-classic/packages/app`, lockfile: "yarn.lock" }
  ] as const
  // `npm ci`, `pnpm --frozen-lockfile`, `yarn --immutable` — all REQUIRE
  // the lockfile and validate it against the (trimmed) manifest.
  const FROZEN_RE = /(^| )(ci|--frozen-lockfile|--immutable)( |$)/
  for (const c of cases) {
    it.effect(`${c.pm}: never both deletes the lockfile and runs a frozen install`, () =>
      Effect.gen(function*() {
        const base = minimalSpec(c.target)
        const spec: DockerSpec = {
          ...base,
          runner: { ...base.runner, production: true }
        }
        const bundle = yield* lower(spec)
        const stage = bundle.prod.stages.find((s) => s.name === "prod-deps")
        expect(stage).toBeDefined()
        const runs = (stage?.instructions ?? []).filter(
          (i) => i._tag === "Run"
        ) as ReadonlyArray<{ cmd: string }>
        const deletesLockfile = runs.some(
          (r) => r.cmd.startsWith("rm -f") && r.cmd.includes(c.lockfile)
        )
        const frozenInstall = runs.some((r) => FROZEN_RE.test(r.cmd))
        // The exact failing combination the fix guards against.
        expect(deletesLockfile && frozenInstall).toBe(false)
        // Non-bun keeps the lockfile and re-resolves — no frozen install,
        // no lockfile deletion. Bun deletes+regenerates but is non-frozen.
        if (c.pm !== "bun") {
          expect(deletesLockfile).toBe(false)
          expect(frozenInstall).toBe(false)
        }
      }).pipe(Effect.provide(NodeServices.layer)))
  }
})

describe("lower (pnpm fixtures: layout branching)", () => {
  it.effect("pnpm-isolated emits per-workspace node_modules COPY lines in builder", () =>
    Effect.gen(function*() {
      const bundle = yield* lower({
        ...minimalSpec(`${FIXTURES}pnpm-isolated/packages/app`),
        target: `${FIXTURES}pnpm-isolated/packages/app`
      })
      const builder = bundle.prod.stages.find((s) => s.name === "builder")!
      const nmCopies = builder.instructions.filter(
        (i) =>
          i._tag === "Copy" &&
          (i as { src: ReadonlyArray<string> }).src.some((s) => s.includes("node_modules"))
      )
      // Root + 3 closure entries
      expect(nmCopies.length).toBeGreaterThanOrEqual(2)
    }).pipe(Effect.provide(NodeServices.layer)))

  it.effect("pnpm-hoisted emits a single root node_modules COPY in builder", () =>
    Effect.gen(function*() {
      const bundle = yield* lower({
        ...minimalSpec(`${FIXTURES}pnpm-hoisted/packages/app`),
        target: `${FIXTURES}pnpm-hoisted/packages/app`
      })
      const builder = bundle.prod.stages.find((s) => s.name === "builder")!
      const nmCopies = builder.instructions.filter(
        (i) =>
          i._tag === "Copy" &&
          (i as { src: ReadonlyArray<string> }).src.some((s) => s.includes("node_modules"))
      )
      expect(nmCopies.length).toBe(1)
    }).pipe(Effect.provide(NodeServices.layer)))
})
