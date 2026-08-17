import { decodeImagesEffect, ImagesConfig } from "@konfig.ts/core"
import { Data, Effect, Schema } from "effect"
import { FileSystem } from "effect/FileSystem"
import { Path } from "effect/Path"
import { Argument, Command, Flag } from "../_unstable"
import { resolveConfig } from "../configResolver"

export class SetUnknownEnv extends Data.TaggedError("SetUnknownEnv")<{
  readonly env: string
  readonly known: ReadonlyArray<string>
}> {}

export class SetUnknownApp extends Data.TaggedError("SetUnknownApp")<{
  readonly env: string
  readonly app: string
  readonly known: ReadonlyArray<string>
}> {}

export class ImagesFileError extends Data.TaggedError("ImagesFileError")<{
  readonly path: string
  readonly cause: unknown
}> {}

// Tab-indented to match the repo's `images.json` formatting.
const _formatImagesConfig = (decoded: ImagesConfig): string => `${JSON.stringify(decoded, null, "\t")}\n`

export interface SetImageArgs {
  readonly env: string
  readonly app: string
  readonly image: string
  readonly create?: boolean
  readonly from?: string
}

export const setImageEffect = (args: SetImageArgs) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const path = yield* Path
    const cfg = yield* resolveConfig(args.from)

    const file = path.join(cfg.configDir, cfg.config.root, "images.json")
    const text = yield* fs
      .readFileString(file)
      .pipe(Effect.mapError((cause) => new ImagesFileError({ path: file, cause })))

    const parsed = yield* Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown))(text).pipe(
      Effect.mapError((cause) => new ImagesFileError({ path: file, cause }))
    )

    const current = yield* decodeImagesEffect(parsed).pipe(
      Effect.mapError((cause) => new ImagesFileError({ path: file, cause }))
    )

    if (!(args.env in current.envs)) {
      const known = Object.keys(current.envs)
      yield* Effect.logError(`unknown env '${args.env}'. Known: ${known.join(", ")}`)
      return yield* new SetUnknownEnv({ env: args.env, known })
    }

    if (!(args.app in current.envs[args.env]) && !(args.create ?? false)) {
      const known = Object.keys(current.envs[args.env])
      yield* Effect.logError(
        `unknown app '${args.app}' in env '${args.env}'. Known: ${known.join(", ")} (pass --create to add it)`
      )
      return yield* new SetUnknownApp({ env: args.env, app: args.app, known })
    }

    const next: ImagesConfig = {
      envs: {
        ...current.envs,
        [args.env]: { ...current.envs[args.env], [args.app]: args.image }
      }
    }

    const decoded = yield* decodeImagesEffect(next).pipe(
      Effect.mapError((cause) => new ImagesFileError({ path: file, cause }))
    )

    const out = _formatImagesConfig(decoded)
    yield* fs
      .writeFileString(file, out)
      .pipe(Effect.mapError((cause) => new ImagesFileError({ path: file, cause })))

    yield* Effect.log(`set ${args.env}.${args.app} = ${args.image}`)
  })

export const setCommand = Command.make(
  "set",
  {
    env: Argument.string("env").pipe(
      Argument.withDescription("Env key in images.json (e.g. prod, staging)")
    ),
    app: Argument.string("app").pipe(
      Argument.withDescription("App key under envs.<env> in images.json")
    ),
    image: Argument.string("image").pipe(
      Argument.withDescription("Full image ref (e.g. ghcr.io/<org>/<app>:<sha>)")
    ),
    create: Flag.boolean("create").pipe(
      Flag.withDescription("Allow adding a new app key under an existing env (fails otherwise)"),
      Flag.withDefault(false)
    )
  },
  (args) => setImageEffect(args)
).pipe(
  Command.withDescription(
    "Update an image tag in images.json (Schema-validated read + write). "
      + "Fails on an unknown app unless --create is passed to add it."
  )
)
