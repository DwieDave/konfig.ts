import { describe, expect, it } from "@effect/vitest"
import { ConfigProvider, Duration, Effect } from "effect"
import * as Helm from "./Helm"

const _versionTimeoutWith = (env: Record<string, string>) =>
  Helm.versionTimeout.pipe(Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env }))))

describe("api/Helm surface", () => {
  it("exposes exactly the public Helm functions", () => {
    expect(Object.keys(Helm).sort()).toEqual([
      "assertMinVersion",
      "cacheFileName",
      "ensureChartTarball",
      "release",
      "timeout",
      "verifyChartDigest",
      "versionTimeout"
    ])
  })
})

describe("Helm.versionTimeout", () => {
  it.effect("defaults to the 30s version-probe cap", () =>
    Effect.gen(function*() {
      const t = yield* _versionTimeoutWith({})
      expect(Duration.toSeconds(t)).toBe(30)
    }))

  it.effect("follows KONFIG_HELM_TIMEOUT when it is below the cap", () =>
    Effect.gen(function*() {
      const t = yield* _versionTimeoutWith({ KONFIG_HELM_TIMEOUT: "5" })
      expect(Duration.toSeconds(t)).toBe(5)
    }))

  it.effect("never exceeds the cap", () =>
    Effect.gen(function*() {
      const t = yield* _versionTimeoutWith({ KONFIG_HELM_TIMEOUT: "600" })
      expect(Duration.toSeconds(t)).toBe(30)
    }))
})
