import { NodeServices } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { Cause, Console, Effect, Exit, Option, Schema } from "effect"
import { FileSystem } from "effect/FileSystem"
import { Path } from "effect/Path"
import { Command } from "../_unstable"
import { diffCommand, readBaselineDir } from "./diff"

const _write = (file: string, body: string) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const path = yield* Path
    yield* fs.makeDirectory(path.dirname(file), { recursive: true })
    yield* fs.writeFileString(file, body)
  })

describe("readBaselineDir", () => {
  it.effect("recursively collects nested .yaml files with slash-joined keys and skips non-yaml", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const path = yield* Path
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-baseline-" })

      yield* _write(path.join(root, "ConfigMap-top.yaml"), "kind: ConfigMap\n")
      yield* _write(path.join(root, "app", "Service-api.yaml"), "kind: Service\n")
      yield* _write(path.join(root, "app", "deep", "Deployment-api.yaml"), "kind: Deployment\n")
      yield* _write(path.join(root, "README.md"), "notes\n")
      yield* _write(path.join(root, "app", "values.json"), "{}\n")

      const map = yield* readBaselineDir(root)
      expect(Object.keys(map).sort()).toEqual([
        "ConfigMap-top.yaml",
        "app/Service-api.yaml",
        "app/deep/Deployment-api.yaml"
      ])
      expect(map["app/deep/Deployment-api.yaml"]).toBe("kind: Deployment\n")
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("returns an empty map for a missing directory", () =>
    Effect.gen(function*() {
      const path = yield* Path
      const map = yield* readBaselineDir(path.join("/nonexistent-konfig-baseline", "nope"))
      expect(map).toEqual({})
    }).pipe(Effect.provide(NodeServices.layer)))
})

const _envBody = `
import { Bundle } from "@konfig.ts/core";
import { ConfigMap } from "@konfig.ts/k8s";
const api = Bundle.define({
	name: "api",
	namespace: "app",
	build: () => [
		ConfigMap.make({ name: "api-conf", namespace: "app", data: { K: "match" } }),
		ConfigMap.make({ name: "web-conf", namespace: "app", data: { K: "render-value" } }),
	],
});
export default Bundle.entrypoint(Bundle.fromModules({ modules: [api] as const }));
`

/** Rendered content the probe bundle above produces for the "api-conf" ConfigMap. */
const _apiConfYaml = "apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: api-conf\n  namespace: app\ndata:\n  K: match\n"

const _konfigJsonWithDiff = (baselineDirName: string) =>
  JSON.stringify({
    root: "infra",
    envs: { test: { entry: "env/test.ts" } },
    outDir: { manifests: "rendered" },
    diff: { baseline: baselineDirName }
  })

const _konfigJsonNoDiff = JSON.stringify({
  root: "infra",
  envs: { test: { entry: "env/test.ts" } },
  outDir: { manifests: "rendered" }
})

const _findFailure = (cause: Cause.Cause<unknown>): unknown => Option.getOrUndefined(Cause.findErrorOption(cause))

/** Runs `diffCommand` against a temp config dir, capturing Console.log output. */
const _runDiffCommand = (argv: ReadonlyArray<string>, root: string) =>
  Effect.gen(function*() {
    const lines: string[] = []
    const testConsole: Console.Console = Object.assign(Object.create(console), {
      log: (...args: ReadonlyArray<unknown>) => {
        lines.push(args.map(String).join(" "))
      }
    })
    const previousCwd = process.cwd()
    process.chdir(root)
    const exit = yield* Effect.exit(
      Command.runWith(diffCommand, { version: "test" })(argv).pipe(
        Effect.provideService(Console.Console, testConsole)
      )
    ).pipe(Effect.ensuring(Effect.sync(() => process.chdir(previousCwd))))
    return { exit, lines }
  })

describe("diffCommand", () => {
  it.effect("fails with DiffBaselineMissing when the config has no diff.baseline", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const path = yield* Path
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-diffcmd-" })
      yield* fs.makeDirectory(path.join(root, "infra", "env"), { recursive: true })
      yield* fs.writeFileString(path.join(root, "konfig.json"), _konfigJsonNoDiff)
      yield* fs.writeFileString(path.join(root, "infra", "env", "test.ts"), _envBody)

      const { exit } = yield* _runDiffCommand(["test"], root)
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        expect(_findFailure(exit.cause)).toMatchObject({ _tag: "DiffBaselineMissing", env: "test" })
      }
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("prints OK and succeeds when the render exactly matches the baseline", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const path = yield* Path
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-diffcmd-" })
      yield* fs.makeDirectory(path.join(root, "infra", "env"), { recursive: true })
      yield* fs.writeFileString(path.join(root, "konfig.json"), _konfigJsonWithDiff("baseline"))
      yield* fs.writeFileString(path.join(root, "infra", "env", "test.ts"), _envBody)

      const baselineDir = path.join(root, "infra", "baseline", "test")
      yield* fs.makeDirectory(path.join(baselineDir, "api"), { recursive: true })
      yield* fs.writeFileString(path.join(baselineDir, "api", "ConfigMap-api-conf.yaml"), _apiConfYaml)
      yield* fs.writeFileString(
        path.join(baselineDir, "api", "ConfigMap-web-conf.yaml"),
        "apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: web-conf\n  namespace: app\ndata:\n  K: render-value\n"
      )

      const { exit, lines } = yield* _runDiffCommand(["test"], root)
      expect(Exit.isSuccess(exit)).toBe(true)
      expect(lines).toEqual(["OK — env 'test' matches baseline"])
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect(
    "fails with DiffNonEmpty and prints +/-/~ lines for added, removed, and changed files (summary format)",
    () =>
      Effect.gen(function*() {
        const fs = yield* FileSystem
        const path = yield* Path
        const root = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-diffcmd-" })
        yield* fs.makeDirectory(path.join(root, "infra", "env"), { recursive: true })
        yield* fs.writeFileString(path.join(root, "konfig.json"), _konfigJsonWithDiff("baseline"))
        yield* fs.writeFileString(path.join(root, "infra", "env", "test.ts"), _envBody)

        const baselineDir = path.join(root, "infra", "baseline", "test")
        yield* fs.makeDirectory(path.join(baselineDir, "api"), { recursive: true })
        // api-conf matches the render exactly (Same, no output line).
        yield* fs.writeFileString(path.join(baselineDir, "api", "ConfigMap-api-conf.yaml"), _apiConfYaml)
        // web-conf differs from the render (Changed -> "~").
        yield* fs.writeFileString(
          path.join(baselineDir, "api", "ConfigMap-web-conf.yaml"),
          "apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: web-conf\n  namespace: app\ndata:\n  K: baseline-value\n"
        )
        // Baseline-only file the render no longer produces (MissingRight -> "-").
        yield* fs.writeFileString(
          path.join(baselineDir, "api", "ConfigMap-retired.yaml"),
          "apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: retired\n  namespace: app\ndata: {}\n"
        )

        const { exit, lines } = yield* _runDiffCommand(["test", "--format", "summary"], root)
        expect(Exit.isFailure(exit)).toBe(true)
        if (Exit.isFailure(exit)) {
          expect(_findFailure(exit.cause)).toMatchObject({ _tag: "DiffNonEmpty", env: "test" })
        }
        expect(lines).toHaveLength(1)
        const printed = (lines[0] ?? "").split("\n")
        expect(printed).toContain("- api/ConfigMap-retired.yaml")
        expect(printed).toContain("~ api/ConfigMap-web-conf.yaml")
        expect(printed.some((l) => l.includes("ConfigMap-api-conf"))).toBe(false)
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  )

  it.effect("format=json emits the full DiffResult as JSON", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const path = yield* Path
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-diffcmd-" })
      yield* fs.makeDirectory(path.join(root, "infra", "env"), { recursive: true })
      yield* fs.writeFileString(path.join(root, "konfig.json"), _konfigJsonWithDiff("baseline"))
      yield* fs.writeFileString(path.join(root, "infra", "env", "test.ts"), _envBody)

      const baselineDir = path.join(root, "infra", "baseline", "test")
      yield* fs.makeDirectory(path.join(baselineDir, "api"), { recursive: true })
      yield* fs.writeFileString(path.join(baselineDir, "api", "ConfigMap-api-conf.yaml"), _apiConfYaml)
      yield* fs.writeFileString(
        path.join(baselineDir, "api", "ConfigMap-web-conf.yaml"),
        "apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: web-conf\n  namespace: app\ndata:\n  K: baseline-value\n"
      )

      const { exit, lines } = yield* _runDiffCommand(["test", "--format", "json"], root)
      expect(Exit.isFailure(exit)).toBe(true)
      expect(lines).toHaveLength(1)
      const DiffResultJson = Schema.Struct({
        entries: Schema.Array(Schema.Struct({ _tag: Schema.String, file: Schema.String }))
      })
      const parsed = yield* Schema.decodeEffect(Schema.fromJsonString(DiffResultJson))(lines[0] ?? "")
      const changed = parsed.entries.find((e) => e.file === "api/ConfigMap-web-conf.yaml")
      expect(changed?._tag).toBe("Changed")
      const same = parsed.entries.find((e) => e.file === "api/ConfigMap-api-conf.yaml")
      expect(same?._tag).toBe("Same")
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))
})
