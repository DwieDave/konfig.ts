import { NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Effect } from "effect"
import { describe, expect } from "vitest"
import { CopyAtom, type DockerSpec } from "../spec"
import { pkgJson, rootPkgJson, writeTree } from "../testing/tree"
import { copiesOf, requireStage, runsOf } from "./irTesting"
import { lower } from "./lower"

const FIXTURES = new URL("../../fixtures/", import.meta.url).pathname

const specWith = (runner: Partial<DockerSpec["runner"]>): DockerSpec => ({
  runner: {
    workdir: "/app/packages/app",
    copy: [
      CopyAtom.cases.BuilderArtifact.make({ src: "dist", dst: "dist" }),
      CopyAtom.cases.WorkspaceSourceAll.make({})
    ],
    cmd: ["node", "x.js"],
    ...runner
  }
})

const lowerFixture = (input: { readonly fixture: string; readonly runner?: Partial<DockerSpec["runner"]> }) =>
  lower({ target: `${FIXTURES}${input.fixture}/packages/app`, spec: specWith(input.runner ?? {}) })

const nodeModulesCopies = (stage: ReturnType<typeof requireStage>) =>
  copiesOf(stage).filter((c) => c.src.some((s) => /^\/app\/packages\/[^/]+\/node_modules$/.test(s)))

describe("per-workspace node_modules", () => {
  it.effect("npm hoists, so no per-workspace node_modules COPY is emitted", () =>
    Effect.gen(function*() {
      const bundle = yield* lowerFixture({ fixture: "npm" })
      const all = bundle.prod.stages.flatMap(nodeModulesCopies)
      expect(all).toEqual([])
    }).pipe(Effect.provide(NodeServices.layer)))

  it.effect("bun deps stage mkdirs every closure workspace node_modules after install", () =>
    Effect.gen(function*() {
      const bundle = yield* lowerFixture({ fixture: "bun" })
      const cmds = runsOf(requireStage({ bundle, name: "deps" })).map((r) => r.cmd)
      expect(cmds.at(-1)).toBe(
        "mkdir -p packages/shared/node_modules packages/util/node_modules packages/app/node_modules"
      )
    }).pipe(Effect.provide(NodeServices.layer)))

  it.effect("bun prod-deps stage mkdirs closure workspace node_modules last", () =>
    Effect.gen(function*() {
      const bundle = yield* lowerFixture({ fixture: "bun", runner: { production: true } })
      const cmds = runsOf(requireStage({ bundle, name: "prod-deps" })).map((r) => r.cmd)
      expect(cmds.at(-1)).toContain("mkdir -p packages/shared/node_modules")
    }).pipe(Effect.provide(NodeServices.layer)))

  it.effect("production: workspace source never comes from builder", () =>
    Effect.gen(function*() {
      const bundle = yield* lowerFixture({ fixture: "bun", runner: { production: true } })
      const runner = requireStage({ bundle, name: "runner" })
      const sources = requireStage({ bundle, name: "sources" })

      const wsFromBuilder = copiesOf(runner).filter((c) =>
        c.from === "builder" && c.src[0]?.startsWith("/app/packages/")
      )

      expect(wsFromBuilder.filter((c) => !c.src[0]?.includes("/dist"))).toEqual([])

      expect(runsOf(sources)[0]?.cmd).toContain("rm -rf /app/packages/shared/node_modules")
      expect(nodeModulesCopies(runner).every((c) => c.from === "prod-deps")).toBe(true)
    }).pipe(Effect.provide(NodeServices.layer)))

  it.effect("non-production: no redundant node_modules COPY after builder workspace COPY", () =>
    Effect.gen(function*() {
      const bundle = yield* lowerFixture({ fixture: "bun" })
      expect(nodeModulesCopies(requireStage({ bundle, name: "runner" }))).toEqual([])
    }).pipe(Effect.provide(NodeServices.layer)))
})

const toolFiles = {
  "package.json": rootPkgJson({ workspaces: ["packages/*"], extra: { packageManager: "bun@1.3.5" } }),
  "bun.lock": "{}",
  "packages/app/package.json": pkgJson({
    name: "app",
    extra: { engines: { bun: "1.3.5" }, devDependencies: { tool: "workspace:*" } }
  }),
  "packages/tool/package.json": pkgJson({ name: "tool", extra: { dependencies: { esbuild: "^0.20.0" } } })
}

describe("build-only workspace node_modules", () => {
  it.effect("deps and builder cover buildClosure; prod-deps and runner stay on closure", () =>
    Effect.gen(function*() {
      const dir = yield* writeTree(toolFiles)
      const bundle = yield* lower({ target: `${dir}/packages/app`, spec: specWith({ production: true }) })
      const stage = (name: string) => requireStage({ bundle, name })
      const lastRun = (name: string) => runsOf(stage(name)).at(-1)?.cmd
      expect(lastRun("deps")).toContain("packages/tool/node_modules")
      expect(lastRun("prod-deps")).not.toContain("tool")

      expect(nodeModulesCopies(stage("builder")).map((c) => c.src[0])).toContain("/app/packages/tool/node_modules")

      expect(nodeModulesCopies(stage("runner")).map((c) => c.src[0])).not.toContain(
        "/app/packages/tool/node_modules"
      )
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))
})
