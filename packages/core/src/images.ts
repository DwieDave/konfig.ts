import { Data, Effect, Schema } from "effect"
import { strictDecoderOf } from "./decode"

export const EnvImages = Schema.Record(Schema.String, Schema.String)

export type EnvImages = typeof EnvImages.Type

export const ImagesConfig = Schema.Struct({
  envs: Schema.Record(Schema.String, EnvImages)
})

export type ImagesConfig = typeof ImagesConfig.Type

const _imagesDecoder = strictDecoderOf(ImagesConfig)

export const decodeImagesSync = _imagesDecoder.sync
export const decodeImagesEffect = _imagesDecoder.effect

export class ImagesEnvMissing extends Data.TaggedError("ImagesEnvMissing")<{
  readonly env: string
}> {
  override get message(): string {
    return `images.json has no env "${this.env}"`
  }
}

const _own = <V>(input: { readonly record: Readonly<Record<string, V>>; readonly key: string }): V | undefined =>
  Object.hasOwn(input.record, input.key) ? input.record[input.key] : undefined

export interface LookupEnvInput {
  readonly cfg: ImagesConfig
  readonly env: string
}

export const lookupEnv = (input: LookupEnvInput): EnvImages | undefined =>
  _own({ record: input.cfg.envs, key: input.env })

export const lookupEnvEffect = (
  input: LookupEnvInput
): Effect.Effect<EnvImages, ImagesEnvMissing> =>
  Effect.fromNullishOr(_own({ record: input.cfg.envs, key: input.env })).pipe(
    Effect.mapError(() => new ImagesEnvMissing({ env: input.env }))
  )

/** @throws {ImagesEnvMissing} Use `lookupEnvEffect` for a typed error channel instead. */
export const imagesFor = (input: LookupEnvInput): EnvImages => Effect.runSync(lookupEnvEffect(input))

export class ImagesAppMissing extends Data.TaggedError("ImagesAppMissing")<{
  readonly env: string
  readonly app: string
}> {
  override get message(): string {
    return `images.json has no app "${this.app}" in env "${this.env}"`
  }
}

export interface RequireImageInput {
  readonly e: EnvImages
  readonly app: string
  readonly envName: string
}

export const requireImageEffect = (
  input: RequireImageInput
): Effect.Effect<string, ImagesAppMissing> =>
  Effect.fromNullishOr(_own({ record: input.e, key: input.app })).pipe(
    Effect.mapError(() => new ImagesAppMissing({ env: input.envName, app: input.app }))
  )

/** @throws {ImagesAppMissing} Use `requireImageEffect` for a typed error channel instead. */
export const requireImage = (input: RequireImageInput): string => Effect.runSync(requireImageEffect(input))
