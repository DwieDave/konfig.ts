import { decodeImagesEffect, ImagesConfig } from "@konfig.ts/core"
import { Data, Effect } from "effect"
import { FileSystem } from "effect/FileSystem"
import { Path } from "effect/Path"
import { Argument, Command } from "../_unstable"
import { resolveConfig } from "../configResolver"

export class SetUnknownEnv extends Data.TaggedError("SetUnknownEnv")<{
  readonly env: string
  readonly known: ReadonlyArray<string>
}> {}

export class ImagesFileError extends Data.TaggedError("ImagesFileError")<{
  readonly path: string
  readonly cause: unknown
}> {}

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
    )
  },
  (args) =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const path = yield* Path
      const cfg = yield* resolveConfig()

      const file = path.join(cfg.configDir, cfg.config.root, "images.json")
      const text = yield* fs
        .readFileString(file)
        .pipe(Effect.mapError((cause) => new ImagesFileError({ path: file, cause })))

      const parsed = yield* Effect.try({
        // oxlint-disable-next-line app/no-banned-type-assertions app/no-type-assertion
        try: () => JSON.parse(text) as unknown,
        catch: (cause) => new ImagesFileError({ path: file, cause })
      })

      const current = yield* decodeImagesEffect(parsed).pipe(
        Effect.mapError((cause) => new ImagesFileError({ path: file, cause }))
      )

      if (!(args.env in current.envs)) {
        const known = Object.keys(current.envs)
        yield* Effect.logError(`unknown env '${args.env}'. Known: ${known.join(", ")}`)
        return yield* Effect.fail(new SetUnknownEnv({ env: args.env, known }))
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

      const out = `${JSON.stringify(decoded, null, "\t")}\n`
      yield* fs
        .writeFileString(file, out)
        .pipe(Effect.mapError((cause) => new ImagesFileError({ path: file, cause })))

      yield* Effect.log(`set ${args.env}.${args.app} = ${args.image}`)
    })
).pipe(
  Command.withDescription("Update an image tag in images.json (Schema-validated read + write)")
)
