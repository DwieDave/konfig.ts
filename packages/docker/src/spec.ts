import { Schema } from "effect"

const BASE64_CHARSET_RE = /^[A-Za-z0-9+/]{40,}={0,2}$/
const HEX_RE = /^[0-9a-fA-F]+$/
const SK_KEY_RE = /sk_(live|test)_[A-Za-z0-9]{16,}/
const MAX_PATH_SEGMENTS = 3

const _looksLikePath = (s: string): boolean => s.startsWith("/") || s.split("/").length > MAX_PATH_SEGMENTS

const _looksLikeBase64Secret = (s: string): boolean => {
  if (!BASE64_CHARSET_RE.test(s) || HEX_RE.test(s) || _looksLikePath(s)) return false
  const hasSpecial = s.includes("+") || s.includes("=")
  const hasUpper = /[A-Z]/.test(s)
  const hasLower = /[a-z]/.test(s)
  const hasDigit = /[0-9]/.test(s)

  return hasSpecial || (hasUpper && hasLower && hasDigit)
}

const _looksLikeSecret = (s: string): boolean =>
  SK_KEY_RE.test(s) || s.includes("BEGIN PRIVATE KEY") || _looksLikeBase64Secret(s)

const notASecret = Schema.makeFilter<string>(
  (s) =>
    !_looksLikeSecret(s) ||
    "env value matches a common secret pattern; runtime secrets belong in the k8s manifest layer, not the Dockerfile",
  { expected: "a non-secret-looking string" }
)

const EnvValue = Schema.String.check(notASecret)

const EnvRecord = Schema.Record(Schema.String, EnvValue)

const MAX_ID = 2147483647

const _intBetween = (range: { readonly min: number; readonly max: number }) =>
  Schema.Int.check(Schema.isGreaterThanOrEqualTo(range.min), Schema.isLessThanOrEqualTo(range.max))

const PortNumber = _intBetween({ min: 1, max: 65535 })

const Retries = _intBetween({ min: 0, max: MAX_ID })

const UnixId = _intBetween({ min: 1, max: MAX_ID })

const PosixUserName = Schema.String.check(Schema.isPattern(/^[a-z_][a-z0-9_-]{0,31}$/))

const ExposeField = Schema.Union([PortNumber, Schema.Array(PortNumber)])

export const PackageManagerAtom = Schema.TaggedUnion({
  BunPm: {},
  NpmPm: {},
  PnpmPm: {},
  YarnPm: { variant: Schema.optionalKey(Schema.Literals(["classic", "berry"])) }
})

export type PackageManagerAtom = typeof PackageManagerAtom.Type

export const RuntimeAtom = Schema.TaggedUnion({
  BunRuntime: { alpine: Schema.optionalKey(Schema.Boolean) },
  NodeRuntime: { alpine: Schema.optionalKey(Schema.Boolean) }
})

export type RuntimeAtom = typeof RuntimeAtom.Type

export const BuildAtom = Schema.TaggedUnion({
  BuildScript: { script: Schema.String },
  BuildCommand: { argv: Schema.Array(Schema.String) },
  BuildNone: {}
})

export type BuildAtom = typeof BuildAtom.Type

export const CopyAtom = Schema.TaggedUnion({
  BuilderArtifact: {
    src: Schema.String,
    dst: Schema.String,
    chown: Schema.optionalKey(Schema.String)
  },
  WorkspaceSource: { name: Schema.String },
  WorkspaceSourceAll: {},
  CopyPath: {
    src: Schema.String,
    dst: Schema.String,
    from: Schema.optionalKey(Schema.String),
    chown: Schema.optionalKey(Schema.String)
  }
})

export type CopyAtom = typeof CopyAtom.Type

export const HealthcheckAtom = Schema.TaggedUnion({
  HealthcheckHttpGet: {
    path: Schema.String.check(Schema.isStartingWith("/")),
    port: PortNumber,
    interval: Schema.optionalKey(Schema.String),
    timeout: Schema.optionalKey(Schema.String),
    retries: Schema.optionalKey(Retries),
    startPeriod: Schema.optionalKey(Schema.String)
  },
  HealthcheckCommand: {
    argv: Schema.Array(Schema.String),
    interval: Schema.optionalKey(Schema.String),
    timeout: Schema.optionalKey(Schema.String),
    retries: Schema.optionalKey(Retries),
    startPeriod: Schema.optionalKey(Schema.String)
  }
})

export type HealthcheckAtom = typeof HealthcheckAtom.Type

export const UserAtom = Schema.TaggedUnion({
  UserNonRoot: {
    uid: Schema.optionalKey(UnixId),
    gid: Schema.optionalKey(UnixId),
    name: Schema.optionalKey(PosixUserName)
  },
  UserRoot: {}
})

export type UserAtom = typeof UserAtom.Type

export const PlatformAtom = Schema.TaggedUnion({
  PlatformLinuxAmd64: {},
  PlatformLinuxArm64: {}
})

export type PlatformAtom = typeof PlatformAtom.Type

export const RunnerSpec = Schema.Struct({
  workdir: Schema.String,
  copy: Schema.Array(CopyAtom),
  env: Schema.optionalKey(EnvRecord),
  expose: Schema.optionalKey(ExposeField),
  cmd: Schema.Array(Schema.String),
  entrypoint: Schema.optionalKey(Schema.Array(Schema.String)),
  user: Schema.optionalKey(UserAtom),
  healthcheck: Schema.optionalKey(HealthcheckAtom),
  platform: Schema.optionalKey(PlatformAtom),
  production: Schema.optionalKey(Schema.Boolean),
  // When set, the runner does NOT auto-copy /app/node_modules or workspace
  // sources — caller must list every needed COPY via runner.copy.
  baseImage: Schema.optionalKey(
    Schema.Struct({ image: Schema.String, tag: Schema.String })
  ),
  removePaths: Schema.optionalKey(Schema.Array(Schema.String))
})

export type RunnerSpec = typeof RunnerSpec.Type

export const DevSpec = Schema.Struct({
  cmd: Schema.Array(Schema.String),
  env: Schema.optionalKey(EnvRecord),
  expose: Schema.optionalKey(ExposeField),
  workdir: Schema.optionalKey(Schema.String)
})

export type DevSpec = typeof DevSpec.Type

export const DockerSpec = Schema.Struct({
  packageManager: Schema.optionalKey(PackageManagerAtom),
  runtime: Schema.optionalKey(RuntimeAtom),
  build: Schema.optionalKey(BuildAtom),
  sharedRootFiles: Schema.optionalKey(Schema.Array(Schema.String)),
  runner: RunnerSpec,
  dev: Schema.optionalKey(DevSpec)
})

export type DockerSpec = typeof DockerSpec.Type

export const EngineVersion = Schema.String.check(Schema.isPattern(/^\d+(\.\d+){0,2}$/))

export const decodeDockerSpec = Schema.decodeUnknownEffect(DockerSpec)
