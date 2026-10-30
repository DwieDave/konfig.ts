import { NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Effect, Result } from "effect"
import * as fc from "fast-check"
import { describe, expect } from "vitest"
import { PmRuntimeIncompatible } from "../DockerError"
import { CopyAtom, RuntimeAtom } from "../spec"
import type { DockerSpec } from "../spec"
import { pkgJson, rootPkgJson, writeTree } from "../testing/tree"
import { requireStage, runsOf } from "./irTesting"
import { lower } from "./lower"

type PmName = "bun" | "npm" | "pnpm" | "yarn"

type RuntimeName = "Bun" | "Node"

const lockfiles: Record<PmName, Record<string, string>> = {
  bun: { "bun.lock": "{}" },
  npm: { "package-lock.json": "{}" },
  pnpm: { "pnpm-lock.yaml": "x" },
  yarn: { "yarn.lock": "x", ".yarnrc.yml": "nodeLinker: node-modules\n" }
}

const filesFor = (input: { readonly pm: PmName; readonly node: string }) => ({
  "package.json": rootPkgJson({ workspaces: ["packages/*"], extra: { packageManager: `${input.pm}@4.5.0` } }),
  ...lockfiles[input.pm],
  "packages/app/package.json": pkgJson({
    name: "app",
    extra: { engines: { node: input.node, bun: "1.3.5", [input.pm]: "4.5.0" } }
  })
})

const specFor = (runtime: RuntimeName): DockerSpec => ({
  runtime: runtime === "Bun" ? RuntimeAtom.cases.BunRuntime.make({}) : RuntimeAtom.cases.NodeRuntime.make({}),
  runner: {
    workdir: "/app/packages/app",
    copy: [CopyAtom.cases.WorkspaceSourceAll.make({})],
    cmd: ["node", "x.js"]
  }
})

const compatible = (pm: PmName, runtime: RuntimeName): boolean => (pm === "bun") === (runtime === "Bun")

const lowerPair = (input: { readonly pm: PmName; readonly runtime: RuntimeName; readonly node: string }) =>
  Effect.gen(function*() {
    const dir = yield* writeTree(filesFor(input))

    return yield* lower({ target: `${dir}/packages/app`, spec: specFor(input.runtime) })
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))

const pair = fc.record({
  pm: fc.constantFrom<PmName>("bun", "npm", "pnpm", "yarn"),
  runtime: fc.constantFrom<RuntimeName>("Bun", "Node"),
  node: fc.constantFrom("22", "24", "25", "26")
})

describe("pm / runtime compatibility", () => {
  it.effect("emit succeeds exactly for compatible pairs", () =>
    Effect.promise(() =>
      fc.assert(
        fc.asyncProperty(pair, async (input) => {
          const result = await Effect.runPromise(Effect.result(lowerPair(input)))
          expect(Result.isSuccess(result)).toBe(compatible(input.pm, input.runtime))

          if (Result.isFailure(result)) expect(result.failure).toBeInstanceOf(PmRuntimeIncompatible)
        }),
        { numRuns: 32 }
      )
    ))

  it.effect("corepack is installed first for pnpm/yarn on node >= 25 only", () =>
    Effect.promise(() =>
      fc.assert(
        fc.asyncProperty(
          fc.constantFrom<PmName>("pnpm", "yarn"),
          fc.constantFrom("22", "24", "25", "26"),
          async (pm, node) => {
            const bundle = await Effect.runPromise(lowerPair({ pm, runtime: "Node", node }))
            const cmds = runsOf(requireStage({ bundle, name: "deps" })).map((r) => r.cmd)
            expect(cmds.includes("npm install -g corepack")).toBe(Number(node) >= 25)

            if (Number(node) >= 25) expect(cmds[0]).toBe("npm install -g corepack")
          }
        ),
        { numRuns: 12 }
      )
    ))
})
