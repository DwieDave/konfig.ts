import { NodeServices } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { FileSystem } from "effect/FileSystem"
import { Path } from "effect/Path"
import { ConfigNotFound, ConfigParseError, resolveConfig } from "./configResolver"

const _validConfigJson = JSON.stringify({
  root: "infra",
  envs: { prod: { entry: "infra/env/prod.ts" } },
  outDir: { manifests: "rendered" }
})

describe("resolveConfig", () => {
  it.effect("finds and parses konfig.json in the starting directory", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const path = yield* Path
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-resolve-" })

      yield* fs.writeFileString(path.join(root, "konfig.json"), _validConfigJson)

      const resolved = yield* resolveConfig(root)
      expect(resolved.configDir).toBe(path.resolve(root))
      expect(resolved.config.root).toBe("infra")
      expect(resolved.config.envs.prod?.entry).toBe("infra/env/prod.ts")
      // defaults filled in by decodeKonfigConfigEffect
      expect(resolved.config.cluster).toBe("cluster.ts")
      expect(resolved.config.helm?.minVersion).toBe("3.16.0")
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("walks up parent directories to find konfig.json", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const path = yield* Path
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-resolve-" })

      yield* fs.writeFileString(path.join(root, "konfig.json"), _validConfigJson)
      const nested = path.join(root, "a", "b", "c")
      yield* fs.makeDirectory(nested, { recursive: true })

      const resolved = yield* resolveConfig(nested)
      expect(resolved.configDir).toBe(path.resolve(root))
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("fails with ConfigNotFound when no konfig.json exists up to the filesystem root", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-resolve-" })

      const failure = yield* Effect.flip(resolveConfig(root))
      expect(failure).toBeInstanceOf(ConfigNotFound)
      if (failure instanceof ConfigNotFound) {
        expect(failure._tag).toBe("ConfigNotFound")
      }
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("fails with ConfigParseError on invalid JSON", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const path = yield* Path
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-resolve-" })

      yield* fs.writeFileString(path.join(root, "konfig.json"), "{ not valid json")

      const failure = yield* Effect.flip(resolveConfig(root))
      expect(failure).toBeInstanceOf(ConfigParseError)
      if (failure instanceof ConfigParseError) {
        expect(failure._tag).toBe("ConfigParseError")
        expect(failure.path).toBe(path.join(path.resolve(root), "konfig.json"))
      }
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("fails with ConfigParseError when konfig.json cannot be read as a file", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const path = yield* Path
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-resolve-" })

      // a directory named konfig.json exists but cannot be read as a file
      yield* fs.makeDirectory(path.join(root, "konfig.json"), { recursive: true })

      const failure = yield* Effect.flip(resolveConfig(root))
      expect(failure).toBeInstanceOf(ConfigParseError)
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("fails with ConfigParseError when konfig.json fails schema validation", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const path = yield* Path
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-resolve-" })

      // missing required "root" and "outDir" fields
      yield* fs.writeFileString(path.join(root, "konfig.json"), `{ "envs": {} }`)

      const failure = yield* Effect.flip(resolveConfig(root))
      expect(failure).toBeInstanceOf(ConfigParseError)
      expect(failure._tag).toBe("ConfigParseError")
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

})
