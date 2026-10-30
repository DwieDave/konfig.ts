import { NodeServices } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { Effect, Exit } from "effect"
import { FileSystem } from "effect/FileSystem"
import { Path } from "effect/Path"
import * as fc from "fast-check"
import { ImagesFileError, setImageEffect, SetUnknownApp, SetUnknownEnv } from "./set"

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

      yield* setImageEffect({ env: "prod", app: "api", image: "ghcr.io/acme/api:new-sha", cwd: root })

      const written = yield* fs.readFileString(imagesPath)

      const expected = [
        "{",
        "\t\"envs\": {",
        "\t\t\"prod\": {",
        "\t\t\t\"api\": \"ghcr.io/acme/api:new-sha\",",
        "\t\t\t\"web\": \"ghcr.io/acme/web:v1\"",
        "\t\t},",
        "\t\t\"staging\": {}",
        "\t}",
        "}",
        ""
      ].join("\n")

      expect(written).toBe(expected)
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("adds a new app key under an existing env with --create, without disturbing siblings", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const { root, imagesPath } = yield* _setupConfigDir

      yield* setImageEffect({
        env: "staging",
        app: "worker",
        image: "ghcr.io/acme/worker:v3",
        create: true,
        cwd: root
      })

      const written = yield* fs.readFileString(imagesPath)

      const expected = [
        "{",
        "\t\"envs\": {",
        "\t\t\"prod\": {",
        "\t\t\t\"api\": \"ghcr.io/acme/api:old-sha\",",
        "\t\t\t\"web\": \"ghcr.io/acme/web:v1\"",
        "\t\t},",
        "\t\t\"staging\": {",
        "\t\t\t\"worker\": \"ghcr.io/acme/worker:v3\"",
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
        setImageEffect({ env: "qa", app: "api", image: "ghcr.io/acme/api:v9", cwd: root })
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

  it.effect(
    "fails with SetUnknownApp (and leaves the file untouched) for an app absent from the env, without --create",
    () =>
      Effect.gen(function*() {
        const fs = yield* FileSystem
        const { root, imagesPath } = yield* _setupConfigDir
        const before = yield* fs.readFileString(imagesPath)

        const failure = yield* Effect.flip(
          setImageEffect({ env: "staging", app: "worker", image: "ghcr.io/acme/worker:v3", cwd: root })
        )

        expect(failure).toBeInstanceOf(SetUnknownApp)

        if (failure instanceof SetUnknownApp) {
          expect(failure._tag).toBe("SetUnknownApp")
          expect(failure.env).toBe("staging")
          expect(failure.app).toBe("worker")
          expect(failure.known).toEqual([])
        }

        const after = yield* fs.readFileString(imagesPath)
        expect(after).toBe(before)
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  )

  it.effect("fails with SetUnknownApp listing known apps when the env already has entries", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const { root, imagesPath } = yield* _setupConfigDir
      const before = yield* fs.readFileString(imagesPath)

      const failure = yield* Effect.flip(
        setImageEffect({ env: "prod", app: "worker", image: "ghcr.io/acme/worker:v3", cwd: root })
      )

      expect(failure).toBeInstanceOf(SetUnknownApp)

      if (failure instanceof SetUnknownApp) {
        expect(failure.env).toBe("prod")
        expect(failure.app).toBe("worker")
        expect([...failure.known].sort()).toEqual(["api", "web"])
      }

      const after = yield* fs.readFileString(imagesPath)
      expect(after).toBe(before)
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("updates an existing app entry as before, without needing --create", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const { root, imagesPath } = yield* _setupConfigDir

      yield* setImageEffect({ env: "prod", app: "web", image: "ghcr.io/acme/web:v2", cwd: root })

      const written = yield* fs.readFileString(imagesPath)

      const expected = [
        "{",
        "\t\"envs\": {",
        "\t\t\"prod\": {",
        "\t\t\t\"api\": \"ghcr.io/acme/api:old-sha\",",
        "\t\t\t\"web\": \"ghcr.io/acme/web:v2\"",
        "\t\t},",
        "\t\t\"staging\": {}",
        "\t}",
        "}",
        ""
      ].join("\n")

      expect(written).toBe(expected)
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("fails with ImagesFileError when images.json is missing", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const path = yield* Path
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-set-missing-" })
      yield* fs.makeDirectory(path.join(root, "infra"), { recursive: true })
      yield* fs.writeFileString(path.join(root, "konfig.json"), _konfigJson)

      const failure = yield* Effect.flip(
        setImageEffect({ env: "prod", app: "api", image: "ghcr.io/acme/api:v9", cwd: root })
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
        setImageEffect({ env: "prod", app: "api", image: "ghcr.io/acme/api:v9", cwd: root })
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
        setImageEffect({ env: "prod", app: "api", image: "ghcr.io/acme/api:v9", cwd: root })
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
        setImageEffect({ env: "prod", app: "api", image: "ghcr.io/acme/api:v9", cwd: root })
      ).pipe(Effect.ensuring(fs.chmod(imagesPath, 0o644).pipe(Effect.orDie)))

      expect(failure).toBeInstanceOf(ImagesFileError)
      expect(failure._tag).toBe("ImagesFileError")
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))
})

describe("setImageEffect own-property targets", () => {
  const _fail = (args: { env: string; app: string; create?: boolean }) =>
    Effect.gen(function*() {
      const { root } = yield* _setupConfigDir

      return yield* Effect.flip(setImageEffect({ image: "img", cwd: root, ...args }))
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))

  it.effect("rejects prototype keys as apps", () =>
    Effect.gen(function*() {
      expect((yield* _fail({ env: "prod", app: "toString" }))._tag).toBe("SetUnknownApp")
    }))
  it.effect("rejects prototype keys as envs, even with create", () =>
    Effect.gen(function*() {
      expect((yield* _fail({ env: "constructor", app: "api", create: true }))._tag).toBe("SetUnknownEnv")
      expect((yield* _fail({ env: "toString", app: "api" }))._tag).toBe("SetUnknownEnv")
    }))
})

describe("setImageEffect own-property property", () => {
  const key = fc.oneof(
    fc.constantFrom("toString", "constructor", "__proto__", "hasOwnProperty"),
    fc.constantFrom("prod", "staging", "api", "web", "zzz")
  )

  it("accepts a key only when own, or create for app keys", async () => {
    await fc.assert(
      fc.asyncProperty(key, key, fc.boolean(), async (env, app, create) => {
        const exit = await Effect.runPromise(
          Effect.gen(function*() {
            const { root } = yield* _setupConfigDir

            return yield* Effect.exit(setImageEffect({ env, app, create, image: "img", cwd: root }))
          }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
        )

        const envOk = env === "prod" || env === "staging"
        const appOk = env === "prod" ? app === "api" || app === "web" : false
        expect(Exit.isSuccess(exit)).toBe(envOk && (appOk || create))
      }),
      { numRuns: 40 }
    )
  })

  it.effect("rejects env 'toString' without create when only prod exists", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const path = yield* Path
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-set-" })
      yield* fs.makeDirectory(path.join(root, "infra"), { recursive: true })
      yield* fs.writeFileString(path.join(root, "konfig.json"), _konfigJson)
      yield* fs.writeFileString(path.join(root, "infra", "images.json"), `{"envs":{"prod":{"api":"x"}}}`)
      const failure = yield* Effect.flip(setImageEffect({ env: "toString", app: "api", image: "img", cwd: root }))
      expect(failure._tag).toBe("SetUnknownEnv")
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))
})
