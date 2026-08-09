import { NodeServices } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { FileSystem } from "effect/FileSystem"
import { Path } from "effect/Path"
import { ImagesFileError, SetUnknownEnv, setImageEffect } from "./set"

const _konfigJson = JSON.stringify({
  root: "infra",
  envs: { prod: { entry: "infra/env/prod.ts" }, staging: { entry: "infra/env/staging.ts" } },
  outDir: { manifests: "rendered" }
})

const _imagesJson = JSON.stringify({
  envs: {
    prod: { api: "ghcr.io/acme/api:old-sha", web: "ghcr.io/acme/web:v1" },
    staging: {}
  }
})

const _setupConfigDir = Effect.gen(function*() {
  const fs = yield* FileSystem
  const path = yield* Path
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-set-" })
  yield* fs.makeDirectory(path.join(root, "infra"), { recursive: true })
  yield* fs.writeFileString(path.join(root, "konfig.json"), _konfigJson)
  yield* fs.writeFileString(path.join(root, "infra", "images.json"), _imagesJson)
  return { root, imagesPath: path.join(root, "infra", "images.json") }
})

describe("setImageEffect", () => {
  it.effect("updates the target env.app entry and writes tab-indented JSON, preserving other entries", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const { root, imagesPath } = yield* _setupConfigDir

      yield* setImageEffect({ env: "prod", app: "api", image: "ghcr.io/acme/api:new-sha", from: root })

      const written = yield* fs.readFileString(imagesPath)
      const expected = [
        "{",
        '\t"envs": {',
        '\t\t"prod": {',
        '\t\t\t"api": "ghcr.io/acme/api:new-sha",',
        '\t\t\t"web": "ghcr.io/acme/web:v1"',
        "\t\t},",
        '\t\t"staging": {}',
        "\t}",
        "}",
        ""
      ].join("\n")
      expect(written).toBe(expected)
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("adds a new app key under an existing env without disturbing siblings", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const { root, imagesPath } = yield* _setupConfigDir

      yield* setImageEffect({ env: "staging", app: "worker", image: "ghcr.io/acme/worker:v3", from: root })

      const written = yield* fs.readFileString(imagesPath)
      const expected = [
        "{",
        '\t"envs": {',
        '\t\t"prod": {',
        '\t\t\t"api": "ghcr.io/acme/api:old-sha",',
        '\t\t\t"web": "ghcr.io/acme/web:v1"',
        "\t\t},",
        '\t\t"staging": {',
        '\t\t\t"worker": "ghcr.io/acme/worker:v3"',
        "\t\t}",
        "\t}",
        "}",
        ""
      ].join("\n")
      expect(written).toBe(expected)
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("fails with SetUnknownEnv (and leaves the file untouched) for an env absent from images.json", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const { root, imagesPath } = yield* _setupConfigDir
      const before = yield* fs.readFileString(imagesPath)

      const failure = yield* Effect.flip(
        setImageEffect({ env: "qa", app: "api", image: "ghcr.io/acme/api:v9", from: root })
      )

      expect(failure).toBeInstanceOf(SetUnknownEnv)
      if (failure instanceof SetUnknownEnv) {
        expect(failure._tag).toBe("SetUnknownEnv")
        expect(failure.env).toBe("qa")
        expect([...failure.known].sort()).toEqual(["prod", "staging"])
      }

      const after = yield* fs.readFileString(imagesPath)
      expect(after).toBe(before)
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("fails with ImagesFileError when images.json is missing", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const path = yield* Path
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-set-missing-" })
      yield* fs.makeDirectory(path.join(root, "infra"), { recursive: true })
      yield* fs.writeFileString(path.join(root, "konfig.json"), _konfigJson)

      const failure = yield* Effect.flip(
        setImageEffect({ env: "prod", app: "api", image: "ghcr.io/acme/api:v9", from: root })
      )

      expect(failure).toBeInstanceOf(ImagesFileError)
      expect(failure._tag).toBe("ImagesFileError")
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("fails with ImagesFileError when images.json fails Schema validation (unknown key)", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const path = yield* Path
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-set-badschema-" })
      yield* fs.makeDirectory(path.join(root, "infra"), { recursive: true })
      yield* fs.writeFileString(path.join(root, "konfig.json"), _konfigJson)
      yield* fs.writeFileString(
        path.join(root, "infra", "images.json"),
        `{"envs":{"prod":{"api":"x"}},"unexpectedKey":true}`
      )

      const failure = yield* Effect.flip(
        setImageEffect({ env: "prod", app: "api", image: "ghcr.io/acme/api:v9", from: root })
      )

      expect(failure).toBeInstanceOf(ImagesFileError)
      expect(failure._tag).toBe("ImagesFileError")
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("fails with ImagesFileError when images.json is not valid JSON", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const path = yield* Path
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-set-badjson-" })
      yield* fs.makeDirectory(path.join(root, "infra"), { recursive: true })
      yield* fs.writeFileString(path.join(root, "konfig.json"), _konfigJson)
      yield* fs.writeFileString(path.join(root, "infra", "images.json"), "{ not valid json")

      const failure = yield* Effect.flip(
        setImageEffect({ env: "prod", app: "api", image: "ghcr.io/acme/api:v9", from: root })
      )

      expect(failure).toBeInstanceOf(ImagesFileError)
      if (failure instanceof ImagesFileError) {
        expect(failure.path).toBe(path.join(root, "infra", "images.json"))
      }
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("fails with ImagesFileError when the write is rejected (read-only images.json)", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const { root, imagesPath } = yield* _setupConfigDir
      yield* fs.chmod(imagesPath, 0o444)

      const failure = yield* Effect.flip(
        setImageEffect({ env: "prod", app: "api", image: "ghcr.io/acme/api:v9", from: root })
      ).pipe(Effect.ensuring(fs.chmod(imagesPath, 0o644).pipe(Effect.orDie)))

      expect(failure).toBeInstanceOf(ImagesFileError)
      expect(failure._tag).toBe("ImagesFileError")
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))
})
