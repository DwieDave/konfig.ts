import { decodeKonfigConfigEffect, type KonfigConfig, type ResolvedKonfigConfig } from "@konfig.ts/core"
import { Data, Effect, Schema } from "effect"
import { FileSystem } from "effect/FileSystem"
import { Path } from "effect/Path"

export class ConfigNotFound extends Data.TaggedError("ConfigNotFound")<{
  readonly startedFrom: string
}> {}

export class ConfigParseError extends Data.TaggedError("ConfigParseError")<{
  readonly path: string
  readonly cause: unknown
}> {}

const _findConfig = (start: string) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const path = yield* Path

    let current = path.resolve(start)
    while (true) {
      const candidate = path.join(current, "konfig.json")
      const exists = yield* fs.exists(candidate).pipe(Effect.orElseSucceed(() => false))
      if (exists) return candidate
      const parent = path.dirname(current)
      if (parent === current) {
        return yield* new ConfigNotFound({ startedFrom: start })
      }
      current = parent
    }
  })

const _parseConfig = (configPath: string) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const text = yield* fs
      .readFileString(configPath)
      .pipe(Effect.mapError((cause) => new ConfigParseError({ path: configPath, cause })))
    const parsed = yield* Schema.decodeEffect(Schema.UnknownFromJsonString)(text).pipe(
      Effect.mapError((cause) => new ConfigParseError({ path: configPath, cause }))
    )
    return yield* decodeKonfigConfigEffect(parsed).pipe(
      Effect.mapError((cause) => new ConfigParseError({ path: configPath, cause }))
    )
  })

export const resolveConfig = (
  from?: string
): Effect.Effect<ResolvedKonfigConfig, ConfigNotFound | ConfigParseError, FileSystem | Path> =>
  Effect.gen(function*() {
    const path = yield* Path
    const start = from ?? process.cwd()
    const configPath = yield* _findConfig(start)
    const config: KonfigConfig = yield* _parseConfig(configPath)
    const configDir = path.dirname(configPath)
    return { configDir, config }
  })
