import { NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Effect, Exit, Schema } from "effect"
import * as fc from "fast-check"
import { describe, expect } from "vitest"
import type { DockerSpec } from "../spec"
import type { Stage } from "./DockerfileIR"
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
  it.effect("rejects a multi-arch platform with PlatformMultiUnsupported (FROM takes one value)", () =>
    Effect.gen(function*() {
      const spec: DockerSpec = {
        ...minimalSpec(`${FIXTURES}bun/packages/app`),
        runner: {
          ...minimalSpec(`${FIXTURES}bun/packages/app`).runner,
          platform: { _tag: "PlatformMulti", values: ["linux/amd64", "linux/arm64"] }
        }
      }
      const exit = yield* Effect.exit(lower(spec))
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        expect(exit.cause.toString()).toContain("PlatformMultiUnsupported")
      }
    }).pipe(Effect.provide(NodeServices.layer)))

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

  it.effect("workspaceSourceAll expands to per-workspace COPYs (including target)", () =>
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
      ) as ReadonlyArray<{ src: ReadonlyArray<string> }>
      expect(wsCopies.length).toBe(3)
      expect(wsCopies.some((c) => c.src.includes("/app/packages/app"))).toBe(true)
    }).pipe(Effect.provide(NodeServices.layer)))

  it.effect("workspaceSourceAll copies the target's own source into the runner so its cmd can run", () =>
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
      const targetSourceCopy = runner.instructions.find(
        (i) =>
          i._tag === "Copy" &&
          (i as { src: ReadonlyArray<string>; dst: string }).dst === "/app/packages/app" &&
          (i as { src: ReadonlyArray<string> }).src.includes("/app/packages/app")
      )
      expect(targetSourceCopy).toBeDefined()
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
      expect(nmCopies.length).toBe(4)
      expect(nmCopies.every((c) => c.from === "prod-deps")).toBe(true)
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
      const spec: DockerSpec = {
        ...base,
        runner: {
          ...base.runner,
          production: true,
          removePaths: [
            "/app/node_modules/.bun/sharp@*",
            "/app/node_modules/.bun/@img+sharp-linux-*",
            "/app/node_modules/.bun/x'; rm -rf /*",
            "/app/node_modules/.bun/$(whoami)@?"
          ]
        }
      }
      const bundle = yield* lower(spec)
      const stage = bundle.prod.stages.find((s) => s.name === "prod-deps")!
      const rmRuns = stage.instructions.flatMap((i) => (i._tag === "Run" && i.cmd.startsWith("rm -rf ") ? [i.cmd] : []))
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
          lower({ ...base, runner: { ...base.runner, production: true, removePaths: [path] } }).pipe(
            Effect.provide(NodeServices.layer)
          )
        )
        const stage = bundle.prod.stages.find((s) => s.name === "prod-deps")!
        const cmd = stage.instructions.flatMap((i) => (i._tag === "Run" && i.cmd.startsWith("rm -rf ") ? [i.cmd] : []))[0]!
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
        const causeJson = yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(exit.cause)
        expect(causeJson).toContain("BuildScriptMissing")
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
        const causeJson = yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(exit.cause)
        expect(causeJson).toContain("WorkspaceSourceUnknown")
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
        const causeJson = yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(exit.cause)
        expect(causeJson).toContain("SharedRootFileMissing")
      }
    }).pipe(Effect.provide(NodeServices.layer)))

  it.effect("fails EngineVersionMissing when target has no engines.<runtime>", () =>
    Effect.gen(function*() {
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
      const exit = yield* Effect.exit(lower({ ...base, runner: { ...base.runner, production: true } }))
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
        expect(deletesLockfile).toBe(false)
        expect(frozenInstall).toBe(c.pm === "bun")
      }).pipe(Effect.provide(NodeServices.layer)))
  }
})

describe("lower prod-deps stage (bun keeps bun.lock authoritative)", () => {
  const runsOf = (stage: Stage | undefined): ReadonlyArray<string> =>
    (stage?.instructions ?? []).flatMap((i) => (i._tag === "Run" ? [i.cmd] : []))
  const copiedPkgJsons = (stage: Stage | undefined): ReadonlyArray<string> =>
    (stage?.instructions ?? []).flatMap((i) =>
      i._tag === "Copy" ? i.src.filter((src) => src.endsWith("/package.json")) : []
    )

  it.effect("frozen, filtered install over every workspace package.json for any removePaths", () =>
    Effect.gen(function*() {
      const samples = fc.sample(fc.array(fc.string({ minLength: 1, maxLength: 12 }), { maxLength: 4 }), 25)
      for (const removePaths of samples) {
        const base = minimalSpec(`${FIXTURES}bun/packages/app`)
        const bundle = yield* lower({ ...base, runner: { ...base.runner, production: true, removePaths } })
        const stage = bundle.prod.stages.find((s) => s.name === "prod-deps")
        const runs = runsOf(stage)
        expect(runs).toContain("bun install --ignore-scripts --frozen-lockfile --production --filter @fix/app")
        expect(runs.some((r) => r.startsWith("rm -f "))).toBe(false)
        expect(runs.some((r) => r.startsWith("bun -e "))).toBe(false)
        expect([...copiedPkgJsons(stage)].sort()).toEqual([
          "packages/app/package.json",
          "packages/other/package.json",
          "packages/shared/package.json",
          "packages/util/package.json"
        ])
      }
    }).pipe(Effect.provide(NodeServices.layer)))
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
