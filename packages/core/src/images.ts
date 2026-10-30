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

const _own = <V>(record: Readonly<Record<string, V>>, key: string): V | undefined =>
  Object.hasOwn(record, key) ? record[key] : undefined

export interface LookupEnvInput {
  readonly cfg: ImagesConfig
  readonly env: string
}
export const lookupEnv = (input: LookupEnvInput): EnvImages | undefined => _own(input.cfg.envs, input.env)

export const lookupEnvEffect = (
  input: LookupEnvInput
): Effect.Effect<EnvImages, ImagesEnvMissing> =>
  Effect.fromNullishOr(_own(input.cfg.envs, input.env)).pipe(
    Effect.mapError(() => new ImagesEnvMissing({ env: input.env }))
  )

/** @throws {ImagesEnvMissing} Use `lookupEnvEffect` for a typed error channel instead. */
export const imagesFor = (input: LookupEnvInput): EnvImages => Effect.runSync(lookupEnvEffect(input))

export class ImagesAppMissing extends Data.TaggedError("ImagesAppMissing")<{
  readonly env: string
  readonly app: string
}> {}

export interface RequireImageInput {
  readonly e: EnvImages
  readonly app: string
  readonly envName: string
}
export const requireImageEffect = (
  input: RequireImageInput
): Effect.Effect<string, ImagesAppMissing> =>
  Effect.fromNullishOr(_own(input.e, input.app)).pipe(
    Effect.mapError(() => new ImagesAppMissing({ env: input.envName, app: input.app }))
  )

/** @throws {ImagesAppMissing} Use `requireImageEffect` for a typed error channel instead. */
export const requireImage = (input: RequireImageInput): string => Effect.runSync(requireImageEffect(input))
