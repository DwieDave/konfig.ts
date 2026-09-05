import { Helm, HelmVersionTooLow, runProcessString } from "@konfig.ts/core"
import { Effect } from "effect"
import semver from "semver"
import { ChildProcess } from "./_unstable"

// Pre-release/build metadata is preserved: truncating `v3.16.0-rc.1` to
// `3.16.0` would misjudge it as < 3.16.0 by `semver.gte`.
export const _parseHelmVersion = (output: string): string | null => {
  const match = /v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)/.exec(output.trim())
  return match?.[1] ?? null
}

// A failed `helm version` (not on PATH, permission denied, timeout) surfaces as
// its ProcessError/ProcessTimeout so the message names the real cause;
// HelmVersionTooLow is reserved for a version that was actually read.
export const assertHelmVersion = (minVersion: string) =>
  Effect.gen(function*() {
    const cmd = ChildProcess.make("helm", ["version", "--short"])
    const stdout = yield* Helm.versionTimeout.pipe(
      Effect.flatMap((timeout) => runProcessString(cmd, { allowEmptyStdout: false, timeout }))
    )

    const found = _parseHelmVersion(stdout)
    if (!found) {
      return yield* new HelmVersionTooLow({ required: minVersion, found: stdout.trim() })
    }
    if (!semver.gte(found, minVersion)) {
      return yield* new HelmVersionTooLow({ required: minVersion, found })
    }
  }).pipe(Effect.scoped)
