import { NodeServices } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { FileSystem } from "effect/FileSystem"
import { Path } from "effect/Path"
import { ChartRegistryEntryDecodeError, loadChartRegistryEffect } from "./chartRegistry"

const _writeChartFile = (root: string, name: string, body: string) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const path = yield* Path
    const full = path.join(root, name)
    yield* fs.writeFileString(full, body)
    return full
  })

describe("loadChartRegistryEffect", () => {
  it.effect("loads a valid chart module marked with the helm release sentinel", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-chartreg-" })

      yield* _writeChartFile(
        root,
        "postgres.ts",
        `
export const chart = {
  _konfigHelmRelease: true,
  id: "postgres",
  repo: "https://charts.bitnami.com/bitnami",
  chart: "postgresql",
  version: "16.0.0",
  digest: "sha256:abc123"
};
`
      )

      const entries = yield* loadChartRegistryEffect(root)
      expect(entries).toHaveLength(1)
      expect(entries[0]).toEqual({
        id: "postgres",
        repo: "https://charts.bitnami.com/bitnami",
        chart: "postgresql",
        version: "16.0.0",
        digest: "sha256:abc123"
      })
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("defaults id to the filename (without extension) when omitted", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-chartreg-" })

      yield* _writeChartFile(
        root,
        "redis.ts",
        `
export const chart = {
  _konfigHelmRelease: true,
  repo: "https://charts.bitnami.com/bitnami",
  chart: "redis",
  version: "18.0.0"
};
`
      )

      const entries = yield* loadChartRegistryEffect(root)
      expect(entries).toHaveLength(1)
      expect(entries[0]?.id).toBe("redis")
      expect(entries[0]?.digest).toBe("")
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("ignores modules without the helm release sentinel", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-chartreg-" })

      yield* _writeChartFile(root, "notAChart.ts", `export const foo = { bar: 1 };\n`)

      const entries = yield* loadChartRegistryEffect(root)
      expect(entries).toEqual([])
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("ignores files prefixed with underscore and non-.ts files", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-chartreg-" })

      yield* _writeChartFile(
        root,
        "_helper.ts",
        `
export const chart = {
  _konfigHelmRelease: true,
  id: "hidden",
  repo: "https://charts.bitnami.com/bitnami",
  chart: "hidden",
  version: "1.0.0"
};
`
      )
      yield* _writeChartFile(root, "README.md", "not a chart file")

      const entries = yield* loadChartRegistryEffect(root)
      expect(entries).toEqual([])
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("returns an empty registry when the charts directory does not exist", () =>
    Effect.gen(function*() {
      const entries = yield* loadChartRegistryEffect("/nonexistent/konfig-charts-dir-xyz")
      expect(entries).toEqual([])
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("fails with ChartRegistryEntryDecodeError when a marked entry fails schema validation", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-chartreg-" })

      yield* _writeChartFile(
        root,
        "broken.ts",
        `
export const chart = {
  _konfigHelmRelease: true,
  id: "broken",
  repo: "not-a-valid-url",
  chart: "broken",
  version: "1.0.0"
};
`
      )

      const failure = yield* Effect.flip(loadChartRegistryEffect(root))
      expect(failure).toBeInstanceOf(ChartRegistryEntryDecodeError)
      if (failure instanceof ChartRegistryEntryDecodeError) {
        expect(failure.file).toBe("broken.ts")
        expect(failure.message).toContain("malformed chart registry entry in broken.ts")
      }
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("skips a chart module that throws on import and continues loading the rest", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-chartreg-" })

      yield* _writeChartFile(root, "broken-import.ts", `throw new Error("boom during import");\n`)
      yield* _writeChartFile(
        root,
        "ok.ts",
        `
export const chart = {
  _konfigHelmRelease: true,
  id: "ok",
  repo: "https://charts.bitnami.com/bitnami",
  chart: "ok",
  version: "1.0.0"
};
`
      )

      const entries = yield* loadChartRegistryEffect(root)
      expect(entries.map((e) => e.id)).toEqual(["ok"])
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("picks up multiple chart files from the same directory", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-chartreg-" })

      yield* _writeChartFile(
        root,
        "a.ts",
        `
export const chart = {
  _konfigHelmRelease: true,
  id: "a",
  repo: "oci://registry.example.com/charts",
  chart: "a",
  version: "1.0.0"
};
`
      )
      yield* _writeChartFile(
        root,
        "b.ts",
        `
export const chart = {
  _konfigHelmRelease: true,
  id: "b",
  repo: "oci://registry.example.com/charts",
  chart: "b",
  version: "2.0.0"
};
`
      )

      const entries = yield* loadChartRegistryEffect(root)
      expect(entries.map((e) => e.id).sort()).toEqual(["a", "b"])
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))
})
