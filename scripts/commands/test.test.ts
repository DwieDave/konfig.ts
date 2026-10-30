import { NodeServices } from "@effect/platform-node"
import { ConfigProvider, Effect, Layer } from "effect"
import * as Fs from "effect/FileSystem"
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { _stitchSummary, summaryTmpDir } from "./test"

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

describe("_stitchSummary", () => {
  const _stitch = (file: string) =>
    _stitchSummary([{ pkg: "core", output: "", code: 0, summaryFile: undefined }]).pipe(
      Effect.provide(
        Layer.mergeAll(
          NodeServices.layer,
          ConfigProvider.layer(ConfigProvider.fromEnv({ env: { GITHUB_STEP_SUMMARY: file } }))
        )
      )
    )

  it("treats a missing summary file as empty", async () => {
    const dir = mkdtempSync(join(tmpdir(), "stitch-"))
    const file = join(dir, "s.md")
    await Effect.runPromise(_stitch(file))
    expect(readFileSync(file, "utf8")).toContain("core")
  })
  it("fails on an unreadable summary file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "stitch-"))
    const file = join(dir, "s.md")
    writeFileSync(file, "x")
    chmodSync(file, 0)
    await expect(Effect.runPromise(_stitch(file))).rejects.toThrow()
  })
})
