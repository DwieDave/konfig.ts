import { NodeServices } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { allWorkspaces, closureOf, findRoot } from "@konfig.ts/docker"
import { Console, Effect, Exit, Option, Schema } from "effect"
import { FileSystem } from "effect/FileSystem"
import { Path } from "effect/Path"
import fc from "fast-check"
import { runGraph } from "./graph"
import * as layout from "./graph/layout"

const _write = <A>(root: string, rel: string, body: A) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const path = yield* Path
    const full = path.join(root, rel)
    const text = yield* Schema.encodeUnknownEffect(Schema.fromJsonString(Schema.Unknown))(body)
    yield* fs.makeDirectory(path.dirname(full), { recursive: true })
    yield* fs.writeFileString(full, text)
  })

/**
 * Builds a bun-style workspace root: root package.json declares
 * `workspaces: ["packages/*"]`, matching the docker package's own fixtures.
 */
const _buildWorkspace = (root: string) =>
  Effect.gen(function*() {
    yield* _write(root, "package.json", {
      name: "fix-root",
      private: true,
      workspaces: ["packages/*"]
    })
    yield* _write(root, "packages/app/package.json", {
      name: "@fix/app",
      version: "0.0.0",
      dependencies: { "@fix/util": "workspace:*" },
      devDependencies: { "@fix/dev-only": "workspace:*" },
      scripts: { build: "echo build" }
    })
    yield* _write(root, "packages/util/package.json", {
      name: "@fix/util",
      version: "0.0.0"
    })
    yield* _write(root, "packages/dev-only/package.json", {
      name: "@fix/dev-only",
      version: "0.0.0"
    })
  })

const _captured = () => {
  const messages: string[] = []
  const errors: string[] = []

  const testConsole: Console.Console = Object.assign(Object.create(console), {
    log: (...args: ReadonlyArray<unknown>) => messages.push(args.join(" ")),
    error: (...args: ReadonlyArray<unknown>) => errors.push(args.join(" "))
  })

  return { messages, errors, testConsole }
}

describe("runGraph", () => {
  it.effect("renders the whole monorepo graph with node names and edge counts", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-graph-" })
      yield* _buildWorkspace(root)
      const { messages, testConsole } = _captured()

      yield* runGraph({
        cwd: root,
        target: Option.none(),
        withDev: false,
        full: false
      }).pipe(Effect.provideService(Console.Console, testConsole))

      expect(messages).toHaveLength(1)
      const out = messages[0] ?? ""
      expect(out).toContain("monorepo workspaces")
      expect(out).toContain("@fix/app")
      expect(out).toContain("@fix/util")
      expect(out).toContain("1 runtime edge")
      // devDependency edge is excluded by default (withDev: false) — the
      // legend only mentions "dev edge" when --with-dev is passed
      expect(out).not.toContain("dev edge")
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("draws edges for semver-range workspace deps (npm/yarn classic)", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-graph-" })
      yield* _write(root, "package.json", { name: "r", workspaces: ["packages/*"] })
      yield* _write(root, "packages/a/package.json", { name: "@s/a", dependencies: { "@s/b": "^1.0.0" } })
      yield* _write(root, "packages/b/package.json", { name: "@s/b", version: "1.0.0" })
      const { messages, testConsole } = _captured()
      yield* runGraph({ cwd: root, target: Option.none(), withDev: false, full: false }).pipe(
        Effect.provideService(Console.Console, testConsole)
      )
      expect(messages[0] ?? "").toContain("1 runtime edge")
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("--with-dev includes the dev edge and dev-only workspace in the render", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-graph-" })
      yield* _buildWorkspace(root)
      const { messages, testConsole } = _captured()

      yield* runGraph({
        cwd: root,
        target: Option.none(),
        withDev: true,
        full: false
      }).pipe(Effect.provideService(Console.Console, testConsole))

      const out = messages[0] ?? ""
      expect(out).toContain("@fix/dev-only")
      expect(out).toContain("1 dev edge")
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("resolving a target by relDir renders only its dependency closure", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-graph-" })
      yield* _buildWorkspace(root)
      const { messages, testConsole } = _captured()

      yield* runGraph({
        cwd: root,
        target: Option.some("packages/app"),
        withDev: false,
        full: false
      }).pipe(Effect.provideService(Console.Console, testConsole))

      const out = messages[0] ?? ""
      expect(out).toContain("closure: @fix/app")
      expect(out).toContain("@fix/util")
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("resolves ./packages/util and . relative to the cwd", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const path = yield* Path
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-graph-" })
      yield* _buildWorkspace(root)

      const run = (cwd: string, target: string) => {
        const { messages, testConsole } = _captured()

        return runGraph({ cwd, target: Option.some(target), withDev: false, full: false }).pipe(
          Effect.provideService(Console.Console, testConsole),
          Effect.map(() => messages[0] ?? "")
        )
      }

      expect(yield* run(root, "./packages/util")).toContain("closure: @fix/util")
      expect(yield* run(path.join(root, "packages/app"), ".")).toContain("closure: @fix/app")
      expect(yield* run(path.join(root, "packages/app"), "../util")).toContain("closure: @fix/util")
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("unknown target fails with GraphTargetNotFound and carries a message listing candidates", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-graph-" })
      yield* _buildWorkspace(root)
      const { errors, testConsole } = _captured()

      const error = yield* Effect.flip(
        runGraph({
          cwd: root,
          target: Option.some("nope"),
          withDev: false,
          full: false
        }).pipe(Effect.provideService(Console.Console, testConsole))
      )

      expect(error._tag).toBe("GraphTargetNotFound")
      expect(error.message).toContain("workspace 'nope' not found")
      expect(error.message).toContain("@fix/app")
      expect(errors).toEqual([])
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("a workspace dependency cycle fails with CircularWorkspaceDep", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-graph-cycle-" })
      yield* _write(root, "package.json", {
        name: "fix-root",
        private: true,
        workspaces: ["packages/*"]
      })
      yield* _write(root, "packages/a/package.json", {
        name: "@fix/a",
        dependencies: { "@fix/b": "workspace:*" }
      })
      yield* _write(root, "packages/b/package.json", {
        name: "@fix/b",
        dependencies: { "@fix/a": "workspace:*" }
      })
      const { errors, testConsole } = _captured()

      const error = yield* Effect.flip(
        runGraph({
          cwd: root,
          target: Option.none(),
          withDev: false,
          full: false
        }).pipe(Effect.provideService(Console.Console, testConsole))
      )

      expect(error._tag).toBe("CircularWorkspaceDep")
      expect(error.message).toContain("circular workspace dependency")
      expect(errors).toEqual([])
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("a target graph ignores cycles outside the target closure", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-graph-unrelated-" })
      yield* _buildWorkspace(root)
      yield* _write(root, "packages/a/package.json", {
        name: "@fix/a",
        dependencies: { "@fix/b": "workspace:*" }
      })
      yield* _write(root, "packages/b/package.json", {
        name: "@fix/b",
        dependencies: { "@fix/a": "workspace:*" }
      })
      const { messages, testConsole } = _captured()

      yield* runGraph({
        cwd: root,
        target: Option.some("@fix/app"),
        withDev: false,
        full: false
      }).pipe(Effect.provideService(Console.Console, testConsole))

      expect(messages[0] ?? "").toContain("closure: @fix/app")
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("--full disables transitive-edge reduction and reports the full edge set", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-graph-full-" })
      yield* _write(root, "package.json", {
        name: "fix-root",
        private: true,
        workspaces: ["packages/*"]
      })
      // a -> b -> c and a -> c (transitively implied, hidden unless --full)
      yield* _write(root, "packages/a/package.json", {
        name: "@fix/a",
        dependencies: { "@fix/b": "workspace:*", "@fix/c": "workspace:*" }
      })
      yield* _write(root, "packages/b/package.json", {
        name: "@fix/b",
        dependencies: { "@fix/c": "workspace:*" }
      })
      yield* _write(root, "packages/c/package.json", { name: "@fix/c" })

      const { messages: reduced, testConsole: c1 } = _captured()
      yield* runGraph({
        cwd: root,
        target: Option.none(),
        withDev: false,
        full: false
      }).pipe(Effect.provideService(Console.Console, c1))
      expect(reduced[0] ?? "").toContain("2 runtime edges")

      const { messages: full, testConsole: c2 } = _captured()
      yield* runGraph({
        cwd: root,
        target: Option.none(),
        withDev: false,
        full: true
      }).pipe(Effect.provideService(Console.Console, c2))
      expect(full[0] ?? "").toContain("3 runtime edges")
      expect(full[0] ?? "").toContain("full")
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))
})

interface CycleCase {
  readonly size: number
  readonly deps: ReadonlyArray<{ readonly from: number; readonly to: number; readonly dev: boolean }>
  readonly target: number | undefined
  readonly withDev: boolean
}

const arbCycleCase: fc.Arbitrary<CycleCase> = fc.integer({ min: 2, max: 5 }).chain((size) => {
  const idx = fc.integer({ min: 0, max: size - 1 })

  return fc.record({
    size: fc.constant(size),
    deps: fc.array(fc.record({ from: idx, to: idx, dev: fc.boolean() }), { maxLength: 8 }),
    target: fc.option(idx, { nil: undefined }),
    withDev: fc.boolean()
  })
})

const _writeCase = (root: string, c: CycleCase) =>
  Effect.gen(function*() {
    yield* _write(root, "package.json", { name: "r", private: true, workspaces: ["packages/*"] })

    yield* Effect.forEach(Array.from({ length: c.size }, (_, i) => i), (i) => {
      const named = (dev: boolean) =>
        Object.fromEntries(c.deps.filter((d) => d.from === i && d.dev === dev).map((d) => [`w${d.to}`, "workspace:*"]))

      return _write(root, `packages/w${i}/package.json`, {
        name: `w${i}`,
        dependencies: named(false),
        devDependencies: named(true)
      })
    })
  })

const _expectedCycle = (input: { readonly root: string; readonly c: CycleCase }) =>
  Effect.gen(function*() {
    const all = yield* allWorkspaces(yield* findRoot(input.root))
    const byName = [...all].sort((a, b) => (a.name < b.name ? -1 : 1))
    const scope = input.c.target === undefined ? byName : byName.filter((w) => w.name === `w${input.c.target}`)

    const exits = yield* Effect.forEach(
      scope,
      (ws) => Effect.exit(closureOf({ all, target: ws, includeDev: input.c.withDev }))
    )

    return exits.flatMap((e) => Exit.isFailure(e) ? [e] : [])[0]
  })

describe("runGraph cycle detection", () => {
  it("does not export detectCycle from the layout module", () => {
    expect("detectCycle" in layout).toBe(false)
  })

  it("fails exactly when docker closureOf fails, with the same cycle", async () => {
    await fc.assert(
      fc.asyncProperty(arbCycleCase, (c) =>
        Effect.gen(function*() {
          const fs = yield* FileSystem
          const root = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-graph-prop-" })
          yield* _writeCase(root, c)
          const expected = yield* _expectedCycle({ root, c })
          const { testConsole } = _captured()

          const actual = yield* Effect.exit(
            runGraph({
              cwd: root,
              target: c.target === undefined ? Option.none() : Option.some(`w${c.target}`),
              withDev: c.withDev,
              full: false
            }).pipe(Effect.provideService(Console.Console, testConsole))
          )

          expect(Exit.isFailure(actual)).toBe(expected !== undefined)

          if (expected !== undefined && Exit.isFailure(actual)) {
            expect(JSON.stringify(actual.cause)).toBe(JSON.stringify(expected.cause))
          }
        }).pipe(Effect.scoped, Effect.provide(NodeServices.layer), Effect.runPromise)),
      { numRuns: 100 }
    )
  }, 30_000)
})
