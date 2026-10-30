import { NodeServices } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { Effect, Option, Schema } from "effect"
import { FileSystem } from "effect/FileSystem"
import { Path } from "effect/Path"
import { existsOrFalse, findUp, readJsonFile } from "./fsUtil"

const _hasMarker = (dir: string) =>
  Effect.gen(function*() {
    const path = yield* Path

    return yield* existsOrFalse(path.join(dir, "marker"))
  })

describe("existsOrFalse", () => {
  it.effect("is false for a missing path and true for an existing one", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const path = yield* Path
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-exists-" })
      expect(yield* existsOrFalse(path.join(root, "nope"))).toBe(false)
      expect(yield* existsOrFalse(root)).toBe(true)
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))
})

describe("findUp", () => {
  it.effect("returns the nearest ancestor (or self) that passes the test", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const path = yield* Path
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-findup-" })
      const deep = path.join(root, "a", "b")
      yield* fs.makeDirectory(deep, { recursive: true })
      yield* fs.writeFileString(path.join(root, "marker"), "")
      expect(yield* findUp({ from: deep, test: _hasMarker })).toEqual(Option.some(root))
      yield* fs.writeFileString(path.join(deep, "marker"), "")
      expect(yield* findUp({ from: deep, test: _hasMarker })).toEqual(Option.some(deep))
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("is none when nothing up to the filesystem root passes", () =>
    Effect.gen(function*() {
      const found = yield* findUp({ from: "/", test: () => Effect.succeed(false) })
      expect(Option.isNone(found)).toBe(true)
    }).pipe(Effect.provide(NodeServices.layer)))
})

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
})
