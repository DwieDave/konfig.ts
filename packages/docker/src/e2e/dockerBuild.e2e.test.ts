import { NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { runProcessExit } from "@konfig.ts/core"
import { Effect } from "effect"
import { FileSystem } from "effect/FileSystem"
import { ChildProcess } from "effect/process"
import { describe } from "vitest"
import { emit } from "../render/emit"
import { BuildAtom, CopyAtom } from "../spec"

const FIXTURES = new URL("../../fixtures/", import.meta.url).pathname
const enabled = process.env["KONFIG_E2E_DOCKER"] === "1"

const FIXTURE_NAMES = ["bun", "npm", "pnpm-isolated", "pnpm-hoisted", "yarn-classic", "yarn-berry"] as const

const dockerBuild = (input: { readonly fixture: string; readonly dockerfile: string }) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const dir = yield* fs.makeTempDirectoryScoped()
    yield* fs.writeFileString(`${dir}/Dockerfile`, input.dockerfile)

    yield* runProcessExit({
      command: ChildProcess.make("docker", ["build", "-f", `${dir}/Dockerfile`, `${FIXTURES}${input.fixture}`])
    })
  })

describe.skipIf(!enabled)("docker build e2e", () => {
  it.effect.each(FIXTURE_NAMES)("builds %s fixture", (fixture) =>
    Effect.gen(function*() {
      const out = yield* emit({
        spec: {
          build: BuildAtom.cases.BuildNone.make({}),
          runner: {
            workdir: "/app/packages/app",
            copy: [CopyAtom.cases.WorkspaceSourceAll.make({})],
            cmd: ["node", "-e", "0"],
            production: true
          }
        },
        target: `${FIXTURES}${fixture}/packages/app`,
        specPath: "docker.ts"
      })

      yield* dockerBuild({ fixture, dockerfile: out.dockerfile })
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)), 600_000)
})
