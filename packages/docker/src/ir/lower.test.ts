import { NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Effect, Exit, Schema } from "effect"
import * as fc from "fast-check"
import { describe, expect } from "vitest"
import { BuildAtom, CopyAtom } from "../spec"
import type { DockerSpec } from "../spec"
import { FromOf, Instr, type Stage } from "./DockerfileIR"
import { copiesOf, envOf, requireDefined, requireStage, runsOf, stageOf } from "./irTesting"
import { lower, type LowerInput } from "./lower"

const FIXTURES = new URL("../../fixtures/", import.meta.url).pathname

const minimalSpec = (target: string): LowerInput => ({
  target,
  spec: {
    runner: {
      workdir: "/app/packages/app",
      copy: [CopyAtom.cases.BuilderArtifact.make({ src: "dist", dst: "dist" })],
      cmd: ["bun", "run", "dist/main.js"]
    }
  }
})

const withSpec = (input: { readonly base: LowerInput; readonly over: Partial<DockerSpec> }): LowerInput => ({
  ...input.base,
  spec: { ...input.base.spec, ...input.over }
})

const withRunner = (
  input: { readonly base: LowerInput; readonly runner: Partial<DockerSpec["runner"]> }
): LowerInput => ({
  ...input.base,
  spec: { ...input.base.spec, runner: { ...input.base.spec.runner, ...input.runner } }
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
      expect(base.from).toEqual(FromOf.FromImage({ image: "oven/bun", tag: "1.3.5-alpine" }))
    }).pipe(Effect.provide(NodeServices.layer)))

  it.effect("deps stage COPYs every workspace package.json (not just closure)", () =>
    Effect.gen(function*() {
      const bundle = yield* lower(minimalSpec(`${FIXTURES}bun/packages/app`))
      const deps = stageOf("deps")(bundle)
      const pkgJsonCopies = copiesOf(deps).filter((c) => c.src.some((s) => s.endsWith("/package.json")))

      expect(pkgJsonCopies.length).toBe(4)
    }).pipe(Effect.provide(NodeServices.layer)))

  it.effect("builder stage COPYs only closure node_modules (AC-2/AC-8)", () =>
    Effect.gen(function*() {
      const bundle = yield* lower(minimalSpec(`${FIXTURES}bun/packages/app`))
      const builder = stageOf("builder")(bundle)
      const nodeModulesCopies = copiesOf(builder).filter((c) => c.src.some((s) => s.endsWith("/node_modules")))

      expect(nodeModulesCopies.length).toBe(4)
      const allDsts = nodeModulesCopies.map((c) => c.dst)
      expect(allDsts).not.toContain("/app/packages/other/node_modules")
    }).pipe(Effect.provide(NodeServices.layer)))

  it.effect("runner stage injects USER nonRoot (uid 1001) and NODE_ENV=production by default (AC-8)", () =>
    Effect.gen(function*() {
      const bundle = yield* lower(minimalSpec(`${FIXTURES}bun/packages/app`))
      const runner = stageOf("runner")(bundle)
      const entries = envOf(runner)?.entries ?? []
      const runs = runsOf(runner)

      expect(runner?.instructions.some(Instr.$is("User"))).toBe(true)
      expect(entries.find(([k]) => k === "NODE_ENV")?.[1]).toBe("production")
      expect(runs[0]?.cmd).toContain("adduser")
    }).pipe(Effect.provide(NodeServices.layer)))

  it.effect("dev stage is emitted only when spec.dev is set", () =>
    Effect.gen(function*() {
      const specWithDev = withSpec({
        base: minimalSpec(`${FIXTURES}bun/packages/app`),
        over: { dev: { cmd: ["bun", "--watch", "main.ts"] } }
      })

      const bundle = yield* lower(specWithDev)
      expect(bundle.dev).toBeDefined()
      expect(bundle.dev?.stages.map((s) => s.name)).toEqual(["base", "dev"])
    }).pipe(Effect.provide(NodeServices.layer)))

  it.effect("dev stage copies sharedRootFiles like the builder stage does", () =>
    Effect.gen(function*() {
      const spec = withSpec({
        base: minimalSpec(`${FIXTURES}bun/packages/app`),
        over: { sharedRootFiles: ["tsconfig.base.json"], dev: { cmd: ["bun", "--watch", "main.ts"] } }
      })

      const bundle = yield* lower(spec)
      const dev = bundle.dev?.stages.find((s) => s.name === "dev")
      expect(dev).toBeDefined()

      const sharedCopies = copiesOf(dev).filter((c) => c.src.includes("tsconfig.base.json"))

      expect(sharedCopies.length).toBe(1)
    }).pipe(Effect.provide(NodeServices.layer)))

  it.effect("workspaceSourceAll expands to per-workspace COPYs (including target)", () =>
    Effect.gen(function*() {
      const spec = withRunner({
        base: minimalSpec(`${FIXTURES}bun/packages/app`),
        runner: {
          workdir: "/app/packages/app",
          copy: [CopyAtom.cases.WorkspaceSourceAll.make({})],
          cmd: ["bun", "run", "main.ts"]
        }
      })

      const bundle = yield* lower(spec)
      const runner = requireStage({ bundle, name: "runner" })

      const wsCopies = copiesOf(runner).filter((c) =>
        c.src.some((s) => s.startsWith("/app/packages/") && !s.endsWith("/node_modules"))
      )

      expect(wsCopies.length).toBe(3)
      expect(wsCopies.some((c) => c.src.includes("/app/packages/app"))).toBe(true)
    }).pipe(Effect.provide(NodeServices.layer)))

  it.effect("workspaceSourceAll copies the target's own source into the runner so its cmd can run", () =>
    Effect.gen(function*() {
      const spec = withRunner({
        base: minimalSpec(`${FIXTURES}bun/packages/app`),
        runner: {
          workdir: "/app/packages/app",
          copy: [CopyAtom.cases.WorkspaceSourceAll.make({})],
          cmd: ["bun", "run", "main.ts"]
        }
      })

      const bundle = yield* lower(spec)
      const runner = requireStage({ bundle, name: "runner" })

      const targetSourceCopy = copiesOf(runner).find(
        (c) => c.dst === "/app/packages/app" && c.src.includes("/app/packages/app")
      )

      expect(targetSourceCopy).toBeDefined()
    }).pipe(Effect.provide(NodeServices.layer)))

  it.effect("isolated linker copies each closure workspace's node_modules (incl. target) from the deps stage", () =>
    Effect.gen(function*() {
      const spec = withRunner({
        base: minimalSpec(`${FIXTURES}bun/packages/app`),
        runner: {
          workdir: "/app/packages/app",
          production: true,
          copy: [CopyAtom.cases.WorkspaceSourceAll.make({})],
          cmd: ["bun", "run", "main.ts"]
        }
      })

      const bundle = yield* lower(spec)
      const runner = requireStage({ bundle, name: "runner" })

      const nmCopies = copiesOf(runner).filter((c) => c.src.some((s) => s.endsWith("/node_modules")))

      expect(nmCopies.length).toBe(4)
      expect(nmCopies.every((c) => c.from === "prod-deps")).toBe(true)
      expect(
        nmCopies.some((c) => c.src.includes("/app/packages/app/node_modules"))
      ).toBe(true)
    }).pipe(Effect.provide(NodeServices.layer)))

  it.effect("removePaths emits one robustly-escaped `rm -rf` line per path", () =>
    Effect.gen(function*() {
      const base = minimalSpec(`${FIXTURES}bun/packages/app`)

      const spec = withRunner({
        base,
        runner: {
          production: true,
          removePaths: [
            "node_modules/sharp",
            "node_modules/@types/react dom",
            "node_modules/x'; rm -rf /",
            "node_modules/$(whoami)"
          ]
        }
      })

      const bundle = yield* lower(spec)
      const stage = requireStage({ bundle, name: "prod-deps" })

      const rmRuns = runsOf(stage).filter((r) => r.cmd.startsWith("rm -rf "))

      expect(rmRuns.length).toBe(4)
      expect(rmRuns.map((r) => r.cmd)).toEqual([
        `rm -rf 'node_modules/sharp'`,
        `rm -rf 'node_modules/@types/react dom'`,
        `rm -rf 'node_modules/x'\\''; rm -rf /'`,
        `rm -rf 'node_modules/$(whoami)'`
      ])
    }).pipe(Effect.provide(NodeServices.layer)))

  it.effect("removePaths leaves `*` and `?` unquoted so the shell expands them (isolated-linker stores)", () =>
    Effect.gen(function*() {
      const base = minimalSpec(`${FIXTURES}bun/packages/app`)

      const spec = withRunner({
        base,
        runner: {
          production: true,
          removePaths: [
            "/app/node_modules/.bun/sharp@*",
            "/app/node_modules/.bun/@img+sharp-linux-*",
            "/app/node_modules/.bun/x'; rm -rf /*",
            "/app/node_modules/.bun/$(whoami)@?"
          ]
        }
      })

      const bundle = yield* lower(spec)
      const stage = requireStage({ bundle, name: "prod-deps" })
      const rmRuns = runsOf(stage).filter((r) => r.cmd.startsWith("rm -rf ")).map((r) => r.cmd)
      expect(rmRuns).toEqual([
        `rm -rf '/app/node_modules/.bun/sharp@'*`,
        `rm -rf '/app/node_modules/.bun/@img+sharp-linux-'*`,
        `rm -rf '/app/node_modules/.bun/x'\\''; rm -rf /'*`,
        `rm -rf '/app/node_modules/.bun/$(whoami)@'?`
      ])
    }).pipe(Effect.provide(NodeServices.layer)))

  it("removePaths: every non-glob character is single-quoted; globs stay bare (property)", async () => {
    const globFree = (s: string) => !/[*?]/.test(s)
    await fc.assert(
      fc.asyncProperty(fc.string({ minLength: 1, maxLength: 24 }), async (path) => {
        const base = minimalSpec(`${FIXTURES}bun/packages/app`)

        const bundle = await Effect.runPromise(
          lower(withRunner({ base, runner: { production: true, removePaths: [path] } })).pipe(
            Effect.provide(NodeServices.layer)
          )
        )

        const stage = requireStage({ bundle, name: "prod-deps" })

        const cmd = requireDefined({
          value: runsOf(stage).find((r) => r.cmd.startsWith("rm -rf ")),
          what: "rm -rf run"
        }).cmd

        const arg = cmd.slice("rm -rf ".length)

        // Literal paths render exactly as before.
        if (globFree(path)) expect(arg).toBe(`'${path.replaceAll("'", "'\\''")}'`)
        // Outside quotes only glob metacharacters may appear — nothing the shell could interpret otherwise.
        const unquoted = arg.replaceAll("'\\''", "").replace(/'[^']*'/g, "")
        expect(unquoted).toMatch(/^[*?]*$/)
      })
    )
  })

  it.effect("user-supplied env is sorted alphabetically and NODE_ENV not overridden", () =>
    Effect.gen(function*() {
      const spec = withRunner({
        base: minimalSpec(`${FIXTURES}bun/packages/app`),
        runner: { env: { ZED: "9", ABE: "1", NODE_ENV: "staging" } }
      })

      const bundle = yield* lower(spec)
      const runner = requireStage({ bundle, name: "runner" })

      const env = envOf(runner)

      expect(env?.entries.map(([k]) => k)).toEqual(["ABE", "NODE_ENV", "ZED"])
      expect(env?.entries.find(([k]) => k === "NODE_ENV")?.[1]).toBe("staging")
    }).pipe(Effect.provide(NodeServices.layer)))
})

describe("lower error paths", () => {
  it.effect("fails BuildScriptMissing when spec asks for a script the target doesn't have", () =>
    Effect.gen(function*() {
      const spec = withSpec({
        base: minimalSpec(`${FIXTURES}bun/packages/app`),
        over: { build: BuildAtom.cases.BuildScript.make({ script: "nope" }) }
      })

      const exit = yield* Effect.exit(lower(spec))
      expect(Exit.isFailure(exit)).toBe(true)

      if (Exit.isFailure(exit)) {
        const causeJson = yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(exit.cause)
        expect(causeJson).toContain("BuildScriptMissing")
      }
    }).pipe(Effect.provide(NodeServices.layer)))

  it.effect("fails WorkspaceSourceUnknown for a workspace not in closure", () =>
    Effect.gen(function*() {
      const spec = withRunner({
        base: minimalSpec(`${FIXTURES}bun/packages/app`),
        runner: {
          workdir: "/app/packages/app",
          copy: [CopyAtom.cases.WorkspaceSource.make({ name: "@fix/other" })],
          cmd: ["bun", "run", "main.ts"]
        }
      })

      const exit = yield* Effect.exit(lower(spec))
      expect(Exit.isFailure(exit)).toBe(true)

      if (Exit.isFailure(exit)) {
        const causeJson = yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(exit.cause)
        expect(causeJson).toContain("WorkspaceSourceUnknown")
      }
    }).pipe(Effect.provide(NodeServices.layer)))

  it.effect("fails SharedRootFileMissing for a missing shared file", () =>
    Effect.gen(function*() {
      const spec = withSpec({
        base: minimalSpec(`${FIXTURES}bun/packages/app`),
        over: { sharedRootFiles: ["no-such-file.json"] }
      })

      const exit = yield* Effect.exit(lower(spec))
      expect(Exit.isFailure(exit)).toBe(true)

      if (Exit.isFailure(exit)) {
        const causeJson = yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(exit.cause)
        expect(causeJson).toContain("SharedRootFileMissing")
      }
    }).pipe(Effect.provide(NodeServices.layer)))

  it.effect("fails EngineVersionMissing when target has no engines.<runtime>", () =>
    Effect.gen(function*() {
      const spec: LowerInput = {
        target: `${FIXTURES}bun/packages/shared`,
        spec: { runner: { workdir: "/app/packages/shared", copy: [], cmd: ["bun", "run", "main.ts"] } }
      }

      const exit = yield* Effect.exit(lower(spec))
      expect(Exit.isFailure(exit)).toBe(true)

      if (Exit.isFailure(exit)) {
        const causeJson = yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(exit.cause)
        expect(causeJson).toContain("EngineVersionMissing")
      }
    }).pipe(Effect.provide(NodeServices.layer)))
})

describe("lower (bun < 1.2)", () => {
  const legacy = `${FIXTURES}bun-legacy/packages/app`
  it.effect("fails with BunVersionUnsupported when runner.production needs a filtered install", () =>
    Effect.gen(function*() {
      const base = minimalSpec(legacy)
      const exit = yield* Effect.exit(lower(withRunner({ base, runner: { production: true } })))
      expect(Exit.isFailure(exit)).toBe(true)

      if (Exit.isFailure(exit)) {
        expect(exit.cause.toString()).toContain("BunVersionUnsupported")
      }
    }).pipe(Effect.provide(NodeServices.layer)))

  it.effect("still lowers without runner.production", () =>
    Effect.gen(function*() {
      const bundle = yield* lower(minimalSpec(legacy))
      expect(bundle.prod.stages.map((s) => s.name)).not.toContain("prod-deps")
    }).pipe(Effect.provide(NodeServices.layer)))
})

describe("lower prod-deps stage (production install per package manager)", () => {
  const cases = [
    { pm: "bun", target: `${FIXTURES}bun/packages/app`, lockfile: "bun.lock" },
    { pm: "npm", target: `${FIXTURES}npm/packages/app`, lockfile: "package-lock.json" },
    { pm: "pnpm", target: `${FIXTURES}pnpm-isolated/packages/app`, lockfile: "pnpm-lock.yaml" },
    { pm: "yarn", target: `${FIXTURES}yarn-classic/packages/app`, lockfile: "yarn.lock" }
  ] as const

  const FROZEN_RE = /(^| )(ci|--frozen-lockfile|--immutable)( |$)/

  for (const c of cases) {
    it.effect(`${c.pm}: keeps the lockfile; only bun installs frozen`, () =>
      Effect.gen(function*() {
        const base = minimalSpec(c.target)

        const spec = withRunner({ base, runner: { production: true } })

        const bundle = yield* lower(spec)
        const stage = bundle.prod.stages.find((s) => s.name === "prod-deps")
        expect(stage).toBeDefined()

        const runs = runsOf(stage)

        const deletesLockfile = runs.some(
          (r) => r.cmd.startsWith("rm -f") && r.cmd.includes(c.lockfile)
        )

        const frozenInstall = runs.some((r) => FROZEN_RE.test(r.cmd))
        expect(deletesLockfile).toBe(false)
        expect(frozenInstall).toBe(c.pm === "bun")
      }).pipe(Effect.provide(NodeServices.layer)))
  }
})

describe("lower prod-deps stage (bun keeps bun.lock authoritative)", () => {
  const runCmds = (stage: Stage | undefined): ReadonlyArray<string> => runsOf(stage).map((r) => r.cmd)

  const copiedPkgJsons = (stage: Stage | undefined): ReadonlyArray<string> =>
    copiesOf(stage).flatMap((c) => c.src.filter((src) => src.endsWith("/package.json")))

  it.effect("frozen, filtered install over every workspace package.json for any removePaths", () =>
    Effect.gen(function*() {
      const samples = fc.sample(fc.array(fc.string({ minLength: 1, maxLength: 12 }), { maxLength: 4 }), 25)

      yield* Effect.forEach(samples, (removePaths) =>
        Effect.gen(function*() {
          const base = minimalSpec(`${FIXTURES}bun/packages/app`)
          const bundle = yield* lower(withRunner({ base, runner: { production: true, removePaths } }))
          const stage = stageOf("prod-deps")(bundle)
          const runs = runCmds(stage)
          expect(runs).toContain("bun install --ignore-scripts --frozen-lockfile --production --filter @fix/app")
          expect(runs.some((r) => r.startsWith("rm -f "))).toBe(false)
          expect(runs.some((r) => r.startsWith("bun -e "))).toBe(false)
          expect([...copiedPkgJsons(stage)].sort()).toEqual([
            "packages/app/package.json",
            "packages/other/package.json",
            "packages/shared/package.json",
            "packages/util/package.json"
          ])
        }))
    }).pipe(Effect.provide(NodeServices.layer)))
})

describe("lower (pnpm fixtures: layout branching)", () => {
  it.effect("pnpm-isolated emits per-workspace node_modules COPY lines in builder", () =>
    Effect.gen(function*() {
      const bundle = yield* lower({
        ...minimalSpec(`${FIXTURES}pnpm-isolated/packages/app`),
        target: `${FIXTURES}pnpm-isolated/packages/app`
      })

      const builder = requireStage({ bundle, name: "builder" })

      const nmCopies = copiesOf(builder).filter((c) => c.src.some((s) => s.includes("node_modules")))

      expect(nmCopies.length).toBeGreaterThanOrEqual(2)
    }).pipe(Effect.provide(NodeServices.layer)))

  it.effect("pnpm-hoisted emits a single root node_modules COPY in builder", () =>
    Effect.gen(function*() {
      const bundle = yield* lower({
        ...minimalSpec(`${FIXTURES}pnpm-hoisted/packages/app`),
        target: `${FIXTURES}pnpm-hoisted/packages/app`
      })

      const builder = requireStage({ bundle, name: "builder" })

      const nmCopies = copiesOf(builder).filter((c) => c.src.some((s) => s.includes("node_modules")))

      expect(nmCopies.length).toBe(1)
    }).pipe(Effect.provide(NodeServices.layer)))
})
