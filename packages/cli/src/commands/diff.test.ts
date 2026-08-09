import { NodeServices } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { FileSystem } from "effect/FileSystem"
import { Path } from "effect/Path"
import { readBaselineDir } from "./diff"

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
