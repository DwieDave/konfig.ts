import { Effect } from "effect"
import * as Fs from "effect/FileSystem"
import { afterEach, describe, expect, it } from "vitest"
import { _summaryTmpDir } from "./test"

describe("_summaryTmpDir", () => {
  const saved = process.env.GITHUB_STEP_SUMMARY
  afterEach(() => {
    if (saved === undefined) delete process.env.GITHUB_STEP_SUMMARY
    else process.env.GITHUB_STEP_SUMMARY = saved
  })
  it("is undefined without GITHUB_STEP_SUMMARY", () => {
    delete process.env.GITHUB_STEP_SUMMARY
    expect(Effect.runSync(_summaryTmpDir.pipe(Effect.scoped, Effect.provide(Fs.layerNoop({}))))).toBeUndefined()
  })
  it("creates a prefixed temp dir when GITHUB_STEP_SUMMARY is set", () => {
    process.env.GITHUB_STEP_SUMMARY = "/tmp/x"
    const fs = Fs.layerNoop({ makeTempDirectoryScoped: (o) => Effect.succeed(`/tmp/${o?.prefix}1`) })
    expect(Effect.runSync(_summaryTmpDir.pipe(Effect.scoped, Effect.provide(fs)))).toBe("/tmp/konfig-test-summaries-1")
  })
})
