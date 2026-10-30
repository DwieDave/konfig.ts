import { NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Effect } from "effect"
import * as fc from "fast-check"
import { describe, expect, it as plain } from "vitest"
import { BuildAtom, CopyAtom, type DockerSpec } from "../spec"
import { pkgJson, rootPkgJson, writeTree } from "../testing/tree"
import { requireStage, runsOf } from "./irTesting"
import { _nodeModulesPath, lower } from "./lower"
import { shJoin } from "./shell"

type ParseState = {
  readonly words: ReadonlyArray<string>
  readonly cur: string
  readonly active: boolean
  readonly quoted: boolean
  readonly escaped?: boolean
}

const _step = (s: ParseState, ch: string): ParseState => {
  if (s.escaped === true) return { ...s, cur: s.cur + ch, escaped: false, active: true }

  if (s.quoted) return ch === "'" ? { ...s, quoted: false } : { ...s, cur: s.cur + ch }

  if (ch === "'") return { ...s, quoted: true, active: true }

  if (ch === "\\") return { ...s, escaped: true }

  if (ch === " ") return s.active ? { words: [...s.words, s.cur], cur: "", active: false, quoted: false } : s

  return { ...s, cur: s.cur + ch, active: true }
}

const shellWords = (cmd: string): ReadonlyArray<string> => {
  const end = Array.from(cmd).reduce(_step, { words: [], cur: "", active: false, quoted: false })

  return end.active ? [...end.words, end.cur] : end.words
}

const ws = (relDir: string) => ({
  name: relDir,
  relDir,
  pkg: { name: relDir },
  hasBuildScript: false
})

const spec = (production: boolean): DockerSpec => ({
  runner: {
    workdir: "/app/apps/my app",
    copy: [CopyAtom.cases.WorkspaceSourceAll.make({})],
    cmd: ["node", "x.js"],
    production
  }
})

const files = {
  "package.json": rootPkgJson({ workspaces: ["apps/*", "libs/*"], extra: { packageManager: "bun@1.3.5" } }),
  "bun.lock": "{}",
  "apps/my app/package.json": pkgJson({
    name: "app",
    extra: {
      engines: { bun: "1.3.5" },
      dependencies: { lib: "workspace:*" },
      scripts: { "build all": "true" }
    }
  }),
  "libs/my lib/package.json": pkgJson({ name: "lib" })
}

describe("shell quoting of workspace paths", () => {
  it.effect("deps-stage mkdir quotes relDirs with spaces", () =>
    Effect.gen(function*() {
      const dir = yield* writeTree(files)
      const bundle = yield* lower({ target: `${dir}/apps/my app`, spec: spec(false) })
      expect(runsOf(requireStage({ bundle, name: "deps" })).at(-1)?.cmd).toBe(
        shJoin(["mkdir", "-p", "libs/my lib/node_modules", "apps/my app/node_modules"])
      )
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("BuildScript with spaces is quoted", () =>
    Effect.gen(function*() {
      const dir = yield* writeTree(files)
      const build = BuildAtom.cases.BuildScript.make({ script: "build all" })
      const bundle = yield* lower({ target: `${dir}/apps/my app`, spec: { ...spec(false), build } })
      expect(runsOf(requireStage({ bundle, name: "builder" })).map((r) => r.cmd)).toContain(
        shJoin(["bun", "run", "build all"])
      )
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("sources-stage rm quotes relDirs with spaces", () =>
    Effect.gen(function*() {
      const dir = yield* writeTree(files)
      const bundle = yield* lower({ target: `${dir}/apps/my app`, spec: spec(true) })
      expect(runsOf(requireStage({ bundle, name: "sources" }))[0]?.cmd).toBe(
        shJoin(["rm", "-rf", "/app/libs/my lib/node_modules", "/app/apps/my app/node_modules"])
      )
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  plain("shJoin round-trips arbitrary node_modules paths through a shell-word parser", () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ unit: fc.constantFrom("a", " ", "'", "\"", "$", ";", "*", "?", "\\", "-") })),
        (dirs) => {
          const argv = ["mkdir", "-p", ...dirs.map((d) => _nodeModulesPath(ws(d)))]
          expect(shellWords(shJoin(argv))).toEqual(argv)
        }
      )
    )
  })
})
