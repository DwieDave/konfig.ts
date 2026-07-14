import { Data, Effect, Schema } from "effect"
import { makeStrictDecoder } from "./decode"

export const EnvImages = Schema.Record(Schema.String, Schema.String)
export type EnvImages = typeof EnvImages.Type

export const ImagesConfig = Schema.Struct({
  envs: Schema.Record(Schema.String, EnvImages)
})
export type ImagesConfig = typeof ImagesConfig.Type

const _imagesDecoder = makeStrictDecoder(ImagesConfig)

export const decodeImagesSync = _imagesDecoder.sync
export const decodeImagesEffect = _imagesDecoder.effect

export class ImagesEnvMissing extends Data.TaggedError("ImagesEnvMissing")<{
  readonly env: string
}> {}

export interface LookupEnvInput {
  readonly cfg: ImagesConfig
  readonly env: string
}
export const lookupEnv = (input: LookupEnvInput): EnvImages | undefined => input.cfg.envs[input.env]

export const lookupEnvEffect = (
  input: LookupEnvInput
): Effect.Effect<EnvImages, ImagesEnvMissing> => {
  const e = input.cfg.envs[input.env]
  return e === undefined ? Effect.fail(new ImagesEnvMissing({ env: input.env })) : Effect.succeed(e)
}

/** @throws {ImagesEnvMissing} Use `lookupEnvEffect` for a typed error channel instead. */
export const imagesFor = (input: LookupEnvInput): EnvImages => {
  const e = input.cfg.envs[input.env]
  if (e === undefined) {
    throw new ImagesEnvMissing({ env: input.env })
  }
  return e
}

export class ImagesAppMissing extends Data.TaggedError("ImagesAppMissing")<{
  readonly env: string
  readonly app: string
}> {}

export interface RequireImageInput {
  readonly e: EnvImages
  readonly app: string
  readonly envName: string
}
/** @throws {ImagesAppMissing} Use `requireImageEffect` for a typed error channel instead. */
export const requireImage = (input: RequireImageInput): string => {
  const v = input.e[input.app]
  if (v === undefined) {
    throw new ImagesAppMissing({ env: input.envName, app: input.app })
  }
  return v
}

export const requireImageEffect = (
  input: RequireImageInput
): Effect.Effect<string, ImagesAppMissing> => {
  const v = input.e[input.app]
  return v === undefined
    ? Effect.fail(new ImagesAppMissing({ env: input.envName, app: input.app }))
    : Effect.succeed(v)
}
