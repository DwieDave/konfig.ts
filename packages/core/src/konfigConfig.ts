import { Effect, Schema } from "effect"
import { strictDecoderOf } from "./decode"
import {
  DEFAULT_CHARTS_DIR,
  DEFAULT_CRD_OUT_DIR,
  DEFAULT_HELM_CACHE_DIR,
  DEFAULT_HELM_MIN_VERSION
} from "./konfigDefaults"

const _stringWithKeyDefault = (def: string) =>
  Schema.String.pipe(Schema.optionalKey, Schema.withDecodingDefaultKey(Effect.succeed(def)))

const _stringArrayWithKeyDefault = (def: ReadonlyArray<string>) =>
  Schema.Array(Schema.String).pipe(
    Schema.optionalKey,
    Schema.withDecodingDefaultKey(Effect.succeed(def))
  )

const EnvEntry = Schema.Struct({
  entry: Schema.String
})

const OutDir = Schema.Struct({
  manifests: Schema.String
})

const CrdConfig = Schema.Struct({
  outDir: _stringWithKeyDefault(DEFAULT_CRD_OUT_DIR)
})

const HelmConfig = Schema.Struct({
  cacheDir: _stringWithKeyDefault(DEFAULT_HELM_CACHE_DIR),
  minVersion: _stringWithKeyDefault(DEFAULT_HELM_MIN_VERSION)
})

const ClusterSpec = Schema.Struct({
  registry: Schema.optionalKey(Schema.String),
  ingressClass: Schema.optionalKey(Schema.String),
  storageClass: Schema.optionalKey(Schema.String),
  repositoryUrl: Schema.optionalKey(Schema.String)
})

const DiffConfig = Schema.Struct({
  baseline: Schema.String
})

const ServicesConfig = Schema.Struct({
  outFile: Schema.optionalKey(Schema.String),
  globalPaths: _stringArrayWithKeyDefault([])
})

export const KonfigConfig = Schema.Struct({
  root: Schema.String,
  cluster: _stringWithKeyDefault("cluster.ts"),
  modules: _stringWithKeyDefault("modules"),
  charts: _stringWithKeyDefault(DEFAULT_CHARTS_DIR),
  envs: Schema.Record(Schema.String, EnvEntry),
  outDir: OutDir,
  crd: Schema.optionalKey(CrdConfig).pipe(Schema.withDecodingDefaultKey(Effect.succeed({}))),
  helm: Schema.optionalKey(HelmConfig).pipe(Schema.withDecodingDefaultKey(Effect.succeed({}))),
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

const _konfigConfigDecoder = strictDecoderOf(KonfigConfig)

export const decodeKonfigConfigSync = _konfigConfigDecoder.sync
export const decodeKonfigConfigEffect = _konfigConfigDecoder.effect
