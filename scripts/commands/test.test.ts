import { ConfigProvider, Effect, Layer } from "effect"
import * as Fs from "effect/FileSystem"
import { describe, expect, it } from "vitest"
import { summaryTmpDir } from "./test"

const _run = (input: { readonly env: Record<string, string>; readonly fs: Layer.Layer<Fs.FileSystem> }) =>
  Effect.runSync(
    summaryTmpDir.pipe(
      Effect.scoped,
      Effect.provide(Layer.mergeAll(input.fs, ConfigProvider.layer(ConfigProvider.fromEnv({ env: input.env }))))
    )
  )

describe("summaryTmpDir", () => {
  it("is undefined without GITHUB_STEP_SUMMARY", () => {
    expect(_run({ env: {}, fs: Fs.layerNoop({}) })).toBeUndefined()
  })
  it("creates a prefixed temp dir when GITHUB_STEP_SUMMARY is set", () => {
    const fs = Fs.layerNoop({ makeTempDirectoryScoped: (o) => Effect.succeed(`/tmp/${o?.prefix}1`) })
    expect(_run({ env: { GITHUB_STEP_SUMMARY: "/tmp/x" }, fs })).toBe("/tmp/konfig-test-summaries-1")
  })
})
