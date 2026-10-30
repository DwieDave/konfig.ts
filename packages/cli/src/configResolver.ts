import { KonfigConfig, type ResolvedKonfigConfig } from "@konfig.ts/core"
import { Data, Effect, Option } from "effect"
import { FileSystem } from "effect/FileSystem"
import { Path } from "effect/Path"
import { existsOrFalse, findUp, readJsonFile } from "./fsUtil"

export class ConfigNotFound extends Data.TaggedError("ConfigNotFound")<{
  readonly startedFrom: string
}> {
  get message(): string {
    return `no konfig.json found in ${this.startedFrom} or any parent directory`
  }
}

export class ConfigParseError extends Data.TaggedError("ConfigParseError")<{
  readonly path: string
  readonly cause: unknown
}> {}

const _CONFIG_FILE = "konfig.json"

const _hasConfig = (dir: string) =>
  Effect.gen(function*() {
    const path = yield* Path

    return yield* existsOrFalse(path.join(dir, _CONFIG_FILE)).pipe(
      Effect.catchReason("PlatformError", "PermissionDenied", () => Effect.succeed(false)),
      Effect.orDie
    )
  })

const _findConfig = (start: string) =>
  Effect.gen(function*() {
    const path = yield* Path
    const dir = yield* findUp({ from: start, test: _hasConfig })

    return yield* Option.match(dir, {
      onNone: () => Effect.fail(new ConfigNotFound({ startedFrom: start })),
      onSome: (found) => Effect.succeed(path.join(found, _CONFIG_FILE))
    })
  })

const _parseConfig = (configPath: string) =>
  readJsonFile({
    path: configPath,
    schema: KonfigConfig,
    onError: (cause) => new ConfigParseError({ path: configPath, cause })
  })

export const resolveConfig = (
  from?: string
): Effect.Effect<ResolvedKonfigConfig, ConfigNotFound | ConfigParseError, FileSystem | Path> =>
  Effect.gen(function*() {
    const path = yield* Path
    const configPath = yield* _findConfig(from ?? process.cwd())
    const config = yield* _parseConfig(configPath)

    return { configDir: path.dirname(configPath), config }
  })
