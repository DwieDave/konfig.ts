import { NodeServices } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { KonfigConfig } from "@konfig.ts/core"
import { Effect, Option, Schema } from "effect"
import { FileSystem } from "effect/FileSystem"
import { Path } from "effect/Path"
import { readJsonFile, writeFileEnsuringDir } from "./fsUtil"

describe("readJsonFile", () => {
  const schema = Schema.Struct({ a: Schema.Finite })

  const read = (text: string) =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const path = yield* Path
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-json-" })
      const file = path.join(root, "x.json")
      yield* fs.writeFileString(file, text)

      return yield* readJsonFile({ path: file, schema, onError: () => "failed" as const }).pipe(
        Effect.flip,
        Effect.option
      )
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))

  it.effect("decodes valid JSON", () =>
    Effect.gen(function*() {
      expect(Option.isNone(yield* read("{\"a\":1}"))).toBe(true)
    }))

  it.effect("maps bad JSON, wrong shape and excess keys to onError", () =>
    Effect.gen(function*() {
      expect(yield* read("{")).toEqual(Option.some("failed"))
      expect(yield* read("{\"a\":\"x\"}")).toEqual(Option.some("failed"))
      expect(yield* read("{\"a\":1,\"b\":2}")).toEqual(Option.some("failed"))
    }))

  it.effect("rejects excess keys on KonfigConfig with an excess-property issue", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const path = yield* Path
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-json-" })
      const file = path.join(root, "konfig.json")
      yield* fs.writeFileString(file, "{\"root\":\".\",\"extra\":1}")

      const cause = yield* readJsonFile({ path: file, schema: KonfigConfig, onError: (c): string => String(c) }).pipe(
        Effect.flip
      )

      expect(cause).toContain("extra")
      expect(cause).toMatch(/unexpected|excess/i)
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))
})

describe("writeFileEnsuringDir", () => {
  it.effect("creates missing parent dirs and writes content with the given mode", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const path = yield* Path
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-write-" })
      const target = path.join(root, "a", "b", "c.txt")

      yield* writeFileEnsuringDir({ path: target, content: "hello", mode: 0o600 })

      expect(yield* fs.readFileString(target)).toBe("hello")
      expect((yield* fs.stat(target)).mode & 0o777).toBe(0o600)
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))
})
