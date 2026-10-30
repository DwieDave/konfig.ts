import { decodeImagesEffect, ImagesConfig } from "@konfig.ts/core"
import { Data, Effect, Schema } from "effect"
import { Argument, Command, Flag } from "effect/cli"
import { FileSystem } from "effect/FileSystem"
import { Path } from "effect/Path"
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

const _imagesFileError = (file: string) => (cause: unknown) => new ImagesFileError({ path: file, cause })

const _readImages = (file: string) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const toError = _imagesFileError(file)
    const text = yield* fs.readFileString(file).pipe(Effect.mapError(toError))

    const parsed = yield* Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown))(text).pipe(
      Effect.mapError(toError)
    )

    return yield* decodeImagesEffect(parsed).pipe(Effect.mapError(toError))
  })

const _assertTarget = (input: { readonly current: ImagesConfig } & Pick<SetImageArgs, "env" | "app" | "create">) =>
  Effect.gen(function*() {
    const { current, env, app } = input
    const envApps = current.envs[env]

    if (envApps === undefined || !(env in current.envs)) {
      const known = Object.keys(current.envs)
      yield* Effect.logError(`unknown env '${env}'. Known: ${known.join(", ")}`)

      return yield* new SetUnknownEnv({ env, known })
    }

    if (!(app in envApps) && !(input.create ?? false)) {
      const known = Object.keys(envApps)
      yield* Effect.logError(
        `unknown app '${app}' in env '${env}'. Known: ${known.join(", ")} (pass --create to add it)`
      )

      return yield* new SetUnknownApp({ env, app, known })
    }
  })

const _withImage = (
  input: { readonly current: ImagesConfig } & Pick<SetImageArgs, "env" | "app" | "image">
): ImagesConfig => ({
  envs: {
    ...input.current.envs,
    [input.env]: { ...input.current.envs[input.env], [input.app]: input.image }
  }
})

export const setImageEffect = (args: SetImageArgs) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const path = yield* Path
    const cfg = yield* resolveConfig(args.from)
    const file = path.join(cfg.configDir, cfg.config.root, "images.json")
    const current = yield* _readImages(file)
    yield* _assertTarget({ ...args, current })

    const decoded = yield* decodeImagesEffect(_withImage({ ...args, current })).pipe(
      Effect.mapError(_imagesFileError(file))
    )

    yield* fs.writeFileString(file, _formatImagesConfig(decoded)).pipe(Effect.mapError(_imagesFileError(file)))
    yield* Effect.log(`set ${args.env}.${args.app} = ${args.image}`)
  })

export const setCommand = Command.make(
  "set",
  {
    env: Argument.String("env").pipe(
      Argument.withDescription("Env key in images.json (e.g. prod, staging)")
    ),
    app: Argument.String("app").pipe(
      Argument.withDescription("App key under envs.<env> in images.json")
    ),
    image: Argument.String("image").pipe(
      Argument.withDescription("Full image ref (e.g. ghcr.io/<org>/<app>:<sha>)")
    ),
    create: Flag.Boolean("create").pipe(
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
