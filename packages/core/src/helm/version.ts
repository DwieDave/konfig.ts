import { Config, type Deferred, Duration, Effect } from "effect"
import { ChildProcess } from "effect/process"
import { ChildProcessSpawner } from "effect/process/ChildProcessSpawner"
import { DEFAULT_HELM_VERSION_TIMEOUT_SECONDS } from "../konfigDefaults"
import { HelmMinVersionInvalid, HelmVersionTooLow } from "../RenderError"
import { compareSemver, parseSemver } from "../semver"
import { singleFlight } from "../singleFlight"
import { type ProcessFailure, runProcessString } from "../subprocess"
import { timeout } from "./timeout"

// The `helm version` preflight is local; capped at the smaller of 30s and the configured timeout.
const versionTimeout: Config.Config<Duration.Duration> = Config.map(
  timeout,
  (t) => Duration.min(t, Duration.seconds(DEFAULT_HELM_VERSION_TIMEOUT_SECONDS))
)

type _HelmVersionProbe = Effect.Effect<string, ProcessFailure | Config.ConfigError, ChildProcessSpawner>

const _helmVersionProbe: _HelmVersionProbe = Effect.gen(function*() {
  const cmd = ChildProcess.make("helm", ["version", "--short"])

  return yield* versionTimeout.pipe(
    Effect.flatMap((t) => runProcessString({ command: cmd, options: { allowEmptyStdout: false, timeout: t } }))
  )
})

type _VersionError = ProcessFailure | Config.ConfigError

const _helmVersionBySpawner = new WeakMap<ChildProcessSpawner["Service"], Deferred.Deferred<string, _VersionError>>()

const _memoizedHelmVersion: _HelmVersionProbe = Effect.gen(function*() {
  const spawner = yield* ChildProcessSpawner

  return yield* singleFlight({
    store: _helmVersionBySpawner,
    key: spawner,
    run: _helmVersionProbe,
    keepOnSuccess: true
  })
})

// A failed `helm version` (not on PATH, permission denied, timeout) surfaces as
// its ProcessError/ProcessTimeout; HelmVersionTooLow is reserved for a version
// that was actually read and is too old (or unparseable). A minVersion that is
// not major.minor[.patch] fails before helm is ever spawned.
export const assertMinVersion = (
  minVersion: string
): Effect.Effect<
  void,
  HelmVersionTooLow | HelmMinVersionInvalid | ProcessFailure | Config.ConfigError,
  ChildProcessSpawner
> =>
  Effect.gen(function*() {
    const min = parseSemver(minVersion)

    if (min === null) return yield* new HelmMinVersionInvalid({ minVersion })
    const stdout = yield* _memoizedHelmVersion
    const found = parseSemver(stdout)

    if (found === null || compareSemver({ a: found, b: min }) < 0) {
      return yield* new HelmVersionTooLow({ required: minVersion, found: stdout.trim() })
    }
  })
