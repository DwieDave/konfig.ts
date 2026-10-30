import { NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Effect, Option } from "effect"
import { FileSystem } from "effect/FileSystem"
import { Path } from "effect/Path"
import { chmodSync } from "node:fs"
import { describe, expect } from "vitest"
import { existsOrFalse, findUp, readOrEmpty } from "./fs"

const _tmp = Effect.gen(function*() {
  const fs = yield* FileSystem

  return yield* fs.makeTempDirectoryScoped()
})

describe("fs helpers", () => {
  it.effect("readOrEmpty gives '' for a missing file", () =>
    Effect.gen(function*() {
      const dir = yield* _tmp
      expect(yield* readOrEmpty(`${dir}/nope`)).toBe("")
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("readOrEmpty propagates non-NotFound errors", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const dir = yield* _tmp
      const file = `${dir}/locked`
      yield* fs.writeFileString(file, "secret")
      chmodSync(file, 0o000)
      const exit = yield* Effect.exit(readOrEmpty(file))
      chmodSync(file, 0o600)
      expect(exit._tag).toBe("Failure")
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("existsOrFalse is false for a missing path and true for a present one", () =>
    Effect.gen(function*() {
      const dir = yield* _tmp
      expect(yield* existsOrFalse(`${dir}/nope`)).toBe(false)
      expect(yield* existsOrFalse(dir)).toBe(true)
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("findUp finds the nearest ancestor and None at root", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const path = yield* Path
      const dir = yield* _tmp
      yield* fs.makeDirectory(`${dir}/a/b`, { recursive: true })
      yield* fs.writeFileString(`${dir}/a/marker`, "")
      const hasMarker = (d: string) => fs.exists(path.join(d, "marker")).pipe(Effect.orDie)
      expect(yield* findUp({ from: `${dir}/a/b`, test: hasMarker })).toEqual(Option.some(path.resolve(`${dir}/a`)))
      expect(yield* findUp({ from: `${dir}/a/b`, test: () => Effect.succeed(false) })).toEqual(Option.none())
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))
})
