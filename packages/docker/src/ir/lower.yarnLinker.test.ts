import { NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Effect } from "effect"
import { describe, expect } from "vitest"
import { UnsupportedYarnLinker } from "../DockerError"
import { CopyAtom, type DockerSpec } from "../spec"
import { Instr } from "./DockerfileIR"
import { copiesOf, requireStage, runsOf } from "./irTesting"
import { lower } from "./lower"

const FIXTURES = new URL("../../fixtures/", import.meta.url).pathname

const spec: DockerSpec = {
  runner: {
    workdir: "/app/packages/app",
    copy: [CopyAtom.cases.WorkspaceSourceAll.make({})],
    cmd: ["node", "x.js"]
  }
}

const lowerFixture = (fixture: string) => lower({ target: `${FIXTURES}${fixture}/packages/app`, spec })

describe("yarn berry linker", () => {
  it.effect("pnp (no nodeLinker) fails with UnsupportedYarnLinker", () =>
    Effect.gen(function*() {
      const error = yield* lowerFixture("yarn-berry-pnp").pipe(Effect.flip)
      expect(error).toBeInstanceOf(UnsupportedYarnLinker)
      expect(error).toMatchObject({ linker: "pnp" })
    }).pipe(Effect.provide(NodeServices.layer)))

  it.effect("yarnPath release file is copied before yarn install", () =>
    Effect.gen(function*() {
      const deps = requireStage({ bundle: yield* lowerFixture("yarn-berry-yarnpath"), name: "deps" })

      const copyIdx = deps.instructions.findIndex((i) =>
        Instr.$is("Copy")(i) && i.src[0] === ".yarn/releases/yarn-4.5.0.cjs"
      )

      const installIdx = deps.instructions.findIndex((i) => Instr.$is("Run")(i) && i.cmd.includes("yarn install"))

      expect(copyIdx).toBeGreaterThanOrEqual(0)
      expect(copyIdx).toBeLessThan(installIdx)
      expect(copiesOf(deps)[1]?.dst).toBe("./.yarn/releases/")
      expect(runsOf(deps).length).toBeGreaterThan(0)
    }).pipe(Effect.provide(NodeServices.layer)))
})
