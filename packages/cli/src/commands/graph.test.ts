import { NodeServices } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { Console, Effect, Option, Schema } from "effect"
import { FileSystem } from "effect/FileSystem"
import { Path } from "effect/Path"
import { runGraph } from "./graph"

const _write = (root: string, rel: string, body: unknown) =>
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
        full: false,
        width: Option.none()
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
        full: false,
        width: Option.none()
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
        full: false,
        width: Option.none()
      }).pipe(Effect.provideService(Console.Console, testConsole))

      const out = messages[0] ?? ""
      expect(out).toContain("closure: @fix/app")
      expect(out).toContain("@fix/util")
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("unknown target fails with GraphTargetNotFound and lists candidates on stderr", () =>
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
          full: false,
          width: Option.none()
        }).pipe(Effect.provideService(Console.Console, testConsole))
      )

      expect(error._tag).toBe("GraphTargetNotFound")
      expect(errors.some((e) => e.includes("workspace 'nope' not found"))).toBe(true)
      expect(errors.some((e) => e.includes("@fix/app"))).toBe(true)
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("a workspace dependency cycle fails with CircularWorkspaceDep on stderr", () =>
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
          full: false,
          width: Option.none()
        }).pipe(Effect.provideService(Console.Console, testConsole))
      )

      expect(error._tag).toBe("CircularWorkspaceDep")
      expect(errors.some((e) => e.includes("workspace cycle detected"))).toBe(true)
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
        full: false,
        width: Option.none()
      }).pipe(Effect.provideService(Console.Console, c1))
      expect(reduced[0] ?? "").toContain("2 runtime edges")

      const { messages: full, testConsole: c2 } = _captured()
      yield* runGraph({
        cwd: root,
        target: Option.none(),
        withDev: false,
        full: true,
        width: Option.none()
      }).pipe(Effect.provideService(Console.Console, c2))
      expect(full[0] ?? "").toContain("3 runtime edges")
      expect(full[0] ?? "").toContain("full")
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("a narrow --width forces the tree-view fallback notice", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-graph-width-" })
      yield* _buildWorkspace(root)
      const { messages, testConsole } = _captured()

      yield* runGraph({
        cwd: root,
        target: Option.none(),
        withDev: false,
        full: false,
        width: Option.some(1)
      }).pipe(Effect.provideService(Console.Console, testConsole))

      const out = messages[0] ?? ""
      expect(out).toContain("falling back to tree view")
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))
})
