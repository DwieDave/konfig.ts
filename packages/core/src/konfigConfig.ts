import { Effect, Schema } from "effect"

const _stringWithKeyDefault = (def: string) =>
  Schema.String.pipe(Schema.optionalKey, Schema.withDecodingDefaultKey(Effect.succeed(def)))

const _stringArrayWithKeyDefault = (def: ReadonlyArray<string>) =>
  Schema.Array(Schema.String).pipe(
    Schema.optionalKey,
    Schema.withDecodingDefaultKey(Effect.succeed(def))
  )

export const EnvEntry = Schema.Struct({
  entry: Schema.String
})
export type EnvEntry = typeof EnvEntry.Type

export const OutDir = Schema.Struct({
  manifests: Schema.String
})
export type OutDir = typeof OutDir.Type

export const CrdConfig = Schema.Struct({
  outDir: _stringWithKeyDefault(".generated/crd")
})
export type CrdConfig = typeof CrdConfig.Type

export const HelmConfig = Schema.Struct({
  cacheDir: _stringWithKeyDefault(".konfig/helm-cache"),
  minVersion: _stringWithKeyDefault("3.16.0")
})
export type HelmConfig = typeof HelmConfig.Type

export const ClusterSpec = Schema.Struct({
  registry: Schema.optionalKey(Schema.String),
  ingressClass: Schema.optionalKey(Schema.String),
  storageClass: Schema.optionalKey(Schema.String),
  repositoryUrl: Schema.optionalKey(Schema.String)
})
export type ClusterSpec = typeof ClusterSpec.Type

export const DiffConfig = Schema.Struct({
  baseline: Schema.String
})
export type DiffConfig = typeof DiffConfig.Type

export const ServicesConfig = Schema.Struct({
  outFile: Schema.optionalKey(Schema.String),
  globalPaths: _stringArrayWithKeyDefault([])
})
export type ServicesConfig = typeof ServicesConfig.Type

export const KonfigConfig = Schema.Struct({
  root: Schema.String,
  cluster: _stringWithKeyDefault("cluster.ts"),
  modules: _stringWithKeyDefault("modules"),
  charts: _stringWithKeyDefault("charts"),
  envs: Schema.Record(Schema.String, EnvEntry),
  outDir: OutDir,
  crd: Schema.optionalKey(CrdConfig).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed({ outDir: ".generated/crd" }))
  ),
  helm: Schema.optionalKey(HelmConfig).pipe(
    Schema.withDecodingDefaultKey(
      Effect.succeed({ cacheDir: ".konfig/helm-cache", minVersion: "3.16.0" })
    )
  ),
  // Extra files/directories/glob patterns (relative to konfig.json)
  // hashed into the build cache input on top of everything under
  // `root` — for inputs that feed a render but live outside the
  // konfig root. Globs use Node glob syntax (requires node >= 22).
  cacheInclude: _stringArrayWithKeyDefault([]),
  diff: Schema.optionalKey(DiffConfig),
  services: Schema.optionalKey(ServicesConfig),
  clusters: Schema.optionalKey(Schema.Record(Schema.String, ClusterSpec))
})
export type KonfigConfig = typeof KonfigConfig.Type

export interface ResolvedKonfigConfig {
  readonly configDir: string
  readonly config: KonfigConfig
}

const strict = { onExcessProperty: "error" } as const
const decodeEff = Schema.decodeUnknownEffect(KonfigConfig)

export const decodeKonfigConfigSync = (input: unknown): KonfigConfig => Effect.runSync(decodeEff(input, strict))
export const decodeKonfigConfigEffect = (input: unknown) => decodeEff(input, strict)
