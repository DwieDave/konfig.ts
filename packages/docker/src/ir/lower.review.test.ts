import { NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Effect } from "effect"
import * as fc from "fast-check"
import { describe, expect } from "vitest"
import type { DetectedPm } from "../services/WorkspaceGraph"
import { BuildAtom, CopyAtom, HealthcheckAtom, PackageManagerAtom, RuntimeAtom } from "../spec"
import type { DockerSpec } from "../spec"
import { pkgJson, rootPkgJson, writeTree } from "../testing/tree"
import { Instr, type Stage } from "./DockerfileIR"
import { runsOf } from "./irTesting"
import { lower, type LowerInput, pmFromAtom } from "./lower"

const FIXTURES = new URL("../../fixtures/", import.meta.url).pathname

const engines = { engines: { node: "22.0.0", npm: "10.5.0", bun: "1.3.5" } }

interface PkgExtra {
  readonly engines: Readonly<Record<string, string>>
}

const baseFiles = (extra: PkgExtra = engines) => ({
  "package.json": rootPkgJson({ workspaces: ["packages/*"], extra: { packageManager: "npm@10.5.0" } }),
  "package-lock.json": "{}",
  "packages/app/package.json": pkgJson({ name: "app", extra })
})

const inputFor = (dir: string, over: Partial<DockerSpec> = {}): LowerInput => ({
  target: `${dir}/packages/app`,
  spec: {
    runner: { workdir: "/app/packages/app", copy: [], cmd: ["node", "x.js"] },
    ...over
  }
})

const runnerOf = (input: LowerInput, runner: Partial<DockerSpec["runner"]>): LowerInput => ({
  ...input,
  spec: { ...input.spec, runner: { ...input.spec.runner, ...runner } }
})

const stageNamed = (stages: ReadonlyArray<Stage>, name: string): Stage | undefined =>
  stages.find((s) => s.name === name)

const healthArgv = (stage: Stage | undefined): ReadonlyArray<string> | undefined =>
  stage?.instructions.find(Instr.$is("Healthcheck"))?.check.argv

const httpGet = HealthcheckAtom.cases.HealthcheckHttpGet.make({ path: "/healthz", port: 8080 })

describe("pmFromAtom", () => {
  const detectedArb = fc.constantFrom<DetectedPm["yarnVariant"]>(undefined, "classic", "berry").map(
    (yarnVariant): DetectedPm => ({ kind: "Yarn", version: undefined, yarnVariant })
  )

  it("an explicit yarn variant always wins over the detected one (property)", () => {
    fc.assert(fc.property(fc.constantFrom("classic", "berry"), detectedArb, (variant, detected) => {
      const pm = pmFromAtom({ atom: PackageManagerAtom.cases.YarnPm.make({ variant }), detected })

      return pm.installCommand.includes("--immutable") === (variant === "berry")
    }))
  })

  it("falls back to the detected variant, then classic", () => {
    const atom = PackageManagerAtom.cases.YarnPm.make({})
    const berry = pmFromAtom({ atom, detected: { kind: "Yarn", version: "4.0.0", yarnVariant: "berry" } })
    const bare = pmFromAtom({ atom, detected: { kind: "Npm", version: undefined } })
    expect(berry.installCommand).toContain("--immutable")
    expect(bare.installCommand).toContain("--frozen-lockfile")
  })
})

describe("lower berry", () => {
  it.effect("an explicit berry variant overrides a classic-detected workspace", () =>
    Effect.gen(function*() {
      const base = inputFor(`${FIXTURES}yarn-classic`)

      const bundle = yield* lower({
        ...base,
        spec: { ...base.spec, packageManager: PackageManagerAtom.cases.YarnPm.make({ variant: "berry" }) }
      })

      const cmds = runsOf(stageNamed(bundle.prod.stages, "deps")).map((i) => i.cmd)
      expect(cmds.some((c) => c.includes("yarn install --immutable"))).toBe(true)
    }).pipe(Effect.provide(NodeServices.layer)))

  it.effect("the prod-deps stage focuses the target with --production so dev dependencies are excluded", () =>
    Effect.gen(function*() {
      const input = runnerOf(inputFor(`${FIXTURES}yarn-berry`), { production: true })
      const bundle = yield* lower(input)
      const cmds = runsOf(stageNamed(bundle.prod.stages, "prod-deps")).map((i) => i.cmd)
      expect(cmds).toContain("YARN_ENABLE_SCRIPTS=false yarn workspaces focus --production @fix/app")
      expect(cmds.some((c) => c.endsWith("yarn install"))).toBe(false)
    }).pipe(Effect.provide(NodeServices.layer)))
})

describe("lower engine versions", () => {
  it.effect("fails with EngineVersionInvalid naming the field for a range", () =>
    Effect.gen(function*() {
      const dir = yield* writeTree(baseFiles({ engines: { ...engines.engines, node: ">=22" } }))
      const failure = yield* Effect.flip(lower(inputFor(dir)))
      expect(failure._tag).toBe("EngineVersionInvalid")
      expect(failure).toMatchObject({ engineField: "engines.node", value: ">=22" })
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("accepts a major.minor engine and tags the image with it", () =>
    Effect.gen(function*() {
      const dir = yield* writeTree(baseFiles({ engines: { ...engines.engines, node: "22.4" } }))
      const bundle = yield* lower(inputFor(dir))
      expect(bundle.prod.stages[0]?.from).toMatchObject({ image: "node", tag: "22.4-alpine" })
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("falls back to the corepack version when engines.<pm> is missing", () =>
    Effect.gen(function*() {
      const dir = yield* writeTree(baseFiles({ engines: { node: "22.0.0" } }))
      const bundle = yield* lower(inputFor(dir, { packageManager: PackageManagerAtom.cases.NpmPm.make({}) }))
      expect(bundle.prod.stages[0]?.from).toMatchObject({ image: "node" })
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))
})

describe("lower healthcheck probe", () => {
  it.effect("alpine runtimes probe with wget", () =>
    Effect.gen(function*() {
      const dir = yield* writeTree(baseFiles())
      const bundle = yield* lower(runnerOf(inputFor(dir), { healthcheck: httpGet }))
      expect(healthArgv(stageNamed(bundle.prod.stages, "runner"))?.[0]).toBe("wget")
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("non-alpine node runtimes probe with node -e fetch", () =>
    Effect.gen(function*() {
      const dir = yield* writeTree(baseFiles())
      const base = inputFor(dir, { runtime: RuntimeAtom.cases.NodeRuntime.make({ alpine: false }) })
      const bundle = yield* lower(runnerOf(base, { healthcheck: httpGet }))
      const argv = healthArgv(stageNamed(bundle.prod.stages, "runner"))
      expect(argv?.slice(0, 2)).toEqual(["node", "-e"])
      expect(argv?.[2]).toContain("http://localhost:8080/healthz")
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("non-alpine bun runtimes probe with bun -e fetch", () =>
    Effect.gen(function*() {
      const dir = yield* writeTree(baseFiles())

      const base = inputFor(dir, {
        packageManager: PackageManagerAtom.cases.BunPm.make({}),
        runtime: RuntimeAtom.cases.BunRuntime.make({ alpine: false })
      })

      const bundle = yield* lower(runnerOf(base, { healthcheck: httpGet }))
      expect(healthArgv(stageNamed(bundle.prod.stages, "runner"))?.slice(0, 2)).toEqual(["bun", "-e"])
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))
})

describe("lower builderArtifact dst", () => {
  const dstOf = (dst: string) =>
    Effect.gen(function*() {
      const dir = yield* writeTree(baseFiles())

      const base = inputFor(dir, {
        build: BuildAtom.cases.BuildNone.make({})
      })

      const bundle = yield* lower(runnerOf(base, { copy: [CopyAtom.cases.BuilderArtifact.make({ src: "dist", dst })] }))

      return stageNamed(bundle.prod.stages, "runner")?.instructions.find(Instr.$is("Copy"))?.dst
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))

  it.effect("keeps an absolute dst as-is", () =>
    Effect.gen(function*() {
      expect(yield* dstOf("/app/dist")).toBe("/app/dist")
    }))

  it.effect("resolves a relative dst under the target", () =>
    Effect.gen(function*() {
      expect(yield* dstOf("dist")).toBe("/app/packages/app/dist")
    }))
})
