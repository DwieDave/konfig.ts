import { Schema } from "effect"

const BASE64_CHARSET_RE = /^[A-Za-z0-9+/]{40,}={0,2}$/
const HEX_RE = /^[0-9a-fA-F]+$/

/**
 * Heuristic for a base64-encoded secret. Deliberately narrower than "long
 * base64 charset" so it does NOT flag common non-secret CI values:
 *
 *  - Pure-hex strings (git SHAs, `sha256` digests, `SENTRY_RELEASE`, …) are
 *    excluded — a 40/64-char commit hash is base64-charset-valid but is not
 *    a secret.
 *  - A mixed-character-class / base64 signal is required: either a base64
 *    special char (`+` `/` `=`) or all three of upper+lower+digit, which
 *    real high-entropy encoded secrets have but low-entropy identifiers
 *    (all-lowercase slugs, numeric ids) do not.
 */
const _looksLikeBase64Secret = (s: string): boolean => {
  if (!BASE64_CHARSET_RE.test(s)) return false
  if (HEX_RE.test(s)) return false
  const hasSpecial = s.includes("+") || s.includes("/") || s.includes("=")
  const hasUpper = /[A-Z]/.test(s)
  const hasLower = /[a-z]/.test(s)
  const hasDigit = /[0-9]/.test(s)
  return hasSpecial || (hasUpper && hasLower && hasDigit)
}

const _looksLikeSecret = (s: string): boolean =>
  s.startsWith("sk_") || s.includes("BEGIN PRIVATE KEY") || _looksLikeBase64Secret(s)

const notASecret = Schema.makeFilter<string>(
  (s) =>
    !_looksLikeSecret(s) ||
    "env value matches a common secret pattern; runtime secrets belong in the k8s manifest layer, not the Dockerfile",
  { expected: "a non-secret-looking string" }
)

const EnvValue = Schema.String.check(notASecret)

const EnvRecord = Schema.Record(Schema.String, EnvValue)

const PortNumber = Schema.Number.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(65535))

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
    path: Schema.String,
    port: PortNumber,
    interval: Schema.optionalKey(Schema.String),
    timeout: Schema.optionalKey(Schema.String),
    retries: Schema.optionalKey(Schema.Number),
    startPeriod: Schema.optionalKey(Schema.String)
  },
  HealthcheckCommand: {
    argv: Schema.Array(Schema.String),
    interval: Schema.optionalKey(Schema.String),
    timeout: Schema.optionalKey(Schema.String),
    retries: Schema.optionalKey(Schema.Number),
    startPeriod: Schema.optionalKey(Schema.String)
  }
})
export type HealthcheckAtom = typeof HealthcheckAtom.Type

export const UserAtom = Schema.TaggedUnion({
  UserNonRoot: {
    uid: Schema.optionalKey(Schema.Number),
    gid: Schema.optionalKey(Schema.Number),
    name: Schema.optionalKey(Schema.String)
  },
  UserRoot: {}
})
export type UserAtom = typeof UserAtom.Type

const PlatformValue = Schema.Literals(["linux/amd64", "linux/arm64"])

export const PlatformAtom = Schema.TaggedUnion({
  PlatformLinuxAmd64: {},
  PlatformLinuxArm64: {},
  PlatformMulti: { values: Schema.Array(PlatformValue) }
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
  /**
   * Emit a separate `prod-deps` stage that runs
   * `<install-command> <productionFlag>` (e.g. `bun install
   * --production`) so the runner gets a `node_modules/` tree without
   * `devDependencies`. Cuts image size when the workload doesn't need
   * typescript / @types / linters / test runners at runtime.
   *
   * Defaults to `false` (runner copies `node_modules` from the
   * `builder` stage, i.e. includes dev deps).
   */
  production: Schema.optionalKey(Schema.Boolean),
  /**
   * Override the runner stage's base image. Defaults to the
   * configured `runtime` image (e.g. `oven/bun:1.3.11-alpine`). Set
   * this when the runtime image of the build (where `tsc` / `vite`
   * etc. ran) is not what should serve at runtime — e.g. a Vite SPA
   * built with bun but served by `nginx:1.29-alpine`.
   *
   * When set, the runner does NOT auto-copy `/app/node_modules` or
   * workspace sources — the caller is responsible for listing every
   * needed COPY via `runner.copy` (typically a few
   * `Docker.copy.path({ from: "builder", src, dst })` instructions).
   */
  baseImage: Schema.optionalKey(
    Schema.Struct({ image: Schema.String, tag: Schema.String })
  ),
  /**
   * Paths under the runner image to delete after all COPY instructions
   * (including `node_modules/`) have run. Use this to strip transitive
   * deps that a workspace doesn't actually need at runtime but are
   * pulled in via shared workspaces (e.g. `node_modules/sharp` from a
   * peer image-processing helper that this CronJob never invokes).
   *
   * Each entry becomes a single `RUN rm -rf <path>` line. Absolute
   * paths are passed verbatim.
   */
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
  target: Schema.String,
  packageManager: Schema.optionalKey(PackageManagerAtom),
  runtime: Schema.optionalKey(RuntimeAtom),
  build: Schema.optionalKey(BuildAtom),
  sharedRootFiles: Schema.optionalKey(Schema.Array(Schema.String)),
  runner: RunnerSpec,
  dev: Schema.optionalKey(DevSpec)
})
export type DockerSpec = typeof DockerSpec.Type

export const decodeDockerSpec = Schema.decodeUnknownEffect(DockerSpec)
// oxlint-disable-next-line app/no-sync-schema-apis
export const decodeDockerSpecSync = Schema.decodeUnknownSync(DockerSpec)
