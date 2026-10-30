import { decodeImagesEffect, ImagesConfig } from "@konfig.ts/core"
import { Console, Data, Effect } from "effect"
import { Argument, Command, Flag } from "effect/cli"
import { FileSystem } from "effect/FileSystem"
import { Path } from "effect/Path"
import { resolveConfig } from "../configResolver"
import { readJsonFile } from "../fsUtil"

export class SetUnknownEnv extends Data.TaggedError("SetUnknownEnv")<{
  readonly env: string
  readonly known: ReadonlyArray<string>
}> {
  get message(): string {
    return `unknown env '${this.env}'. Known: ${this.known.join(", ")}`
  }
}

export class SetUnknownApp extends Data.TaggedError("SetUnknownApp")<{
  readonly env: string
  readonly app: string
  readonly known: ReadonlyArray<string>
}> {
  get message(): string {
    return `unknown app '${this.app}' in env '${this.env}'. Known: ${this.known.join(", ")} (pass --create to add it)`
  }
}

export class ImagesFileError extends Data.TaggedError("ImagesFileError")<{
  readonly path: string
  readonly cause: unknown
}> {}

// Tab-indented to match the repo's `images.json` formatting.
const _formatImagesConfig = (decoded: ImagesConfig): string => `${JSON.stringify(decoded, null, "\t")}\n`

interface SetImageArgs {
  readonly env: string
  readonly app: string
  readonly image: string
  readonly create?: boolean
  readonly cwd: string
}

const _imagesFileError = (file: string) => (cause: unknown) => new ImagesFileError({ path: file, cause })

const _readImages = (file: string) =>
  readJsonFile({ path: file, schema: ImagesConfig, onError: _imagesFileError(file) })

const _assertTarget = (input: { readonly current: ImagesConfig } & Pick<SetImageArgs, "env" | "app" | "create">) => {
  const { app, create, current, env } = input
  const envApps = Object.hasOwn(current.envs, env) ? current.envs[env] : undefined

  if (envApps === undefined) return Effect.fail(new SetUnknownEnv({ env, known: Object.keys(current.envs) }))

  return Object.hasOwn(envApps, app) || (create ?? false)
    ? Effect.void
    : Effect.fail(new SetUnknownApp({ env, app, known: Object.keys(envApps) }))
}

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
    const cfg = yield* resolveConfig(args.cwd)
    const file = path.join(cfg.configDir, cfg.config.root, "images.json")
    const current = yield* _readImages(file)
    yield* _assertTarget({ ...args, current })

    const decoded = yield* decodeImagesEffect(_withImage({ ...args, current })).pipe(
      Effect.mapError(_imagesFileError(file))
    )

    yield* fs.writeFileString(file, _formatImagesConfig(decoded)).pipe(Effect.mapError(_imagesFileError(file)))
    yield* Console.log(`set ${args.env}.${args.app} = ${args.image}`)
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
  (args) => setImageEffect({ ...args, cwd: process.cwd() })
).pipe(
  Command.withDescription(
    "Update an image tag in images.json (Schema-validated read + write). "
      + "Fails on an unknown app unless --create is passed to add it."
  )
)
