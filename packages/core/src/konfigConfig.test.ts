import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { makeStrictDecoder, strictDecoderOf } from "./decode"
import {
  ClusterSpec,
  CrdConfig,
  decodeKonfigConfigEffect,
  decodeKonfigConfigSync,
  DiffConfig,
  EnvEntry,
  HelmConfig,
  KonfigConfig,
  OutDir,
  ServicesConfig
} from "./konfigConfig"

const decode = decodeKonfigConfigSync

describe("konfig.json decoders", () => {
  const minimal = { root: "r", envs: { prod: { entry: "env/prod.ts" } }, outDir: { manifests: "m" } }

  it("decodeKonfigConfigEffect agrees with decodeKonfigConfigSync", () => {
    expect(Effect.runSync(decodeKonfigConfigEffect(minimal))).toEqual(decodeKonfigConfigSync(minimal))
  })

  it("makeStrictDecoder builds the strict decoder pair the config decoders use", () => {
    expect(makeStrictDecoder(KonfigConfig).sync(minimal)).toEqual(decodeKonfigConfigSync(minimal))
  })

  it("rejects unknown keys", () => {
    expect(() => decodeKonfigConfigSync({ ...minimal, typo: true })).toThrow()
  })
})

describe("konfig.json sub-schemas", () => {
  const strict = <S extends Parameters<typeof strictDecoderOf>[0]>(schema: S) => strictDecoderOf(schema).sync

  it("decode each section on its own with the same defaults as KonfigConfig", () => {
    expect(strict(EnvEntry)({ entry: "env/prod.ts" })).toEqual({ entry: "env/prod.ts" })
    expect(strict(OutDir)({ manifests: "m" })).toEqual({ manifests: "m" })
    expect(strict(CrdConfig)({})).toEqual({ outDir: ".generated/crd" })
    expect(strict(HelmConfig)({})).toEqual({ cacheDir: ".konfig/helm-cache", minVersion: "3.16.0" })
    expect(strict(ClusterSpec)({ registry: "ghcr.io/acme" })).toEqual({ registry: "ghcr.io/acme" })
    expect(strict(DiffConfig)({ baseline: "base" })).toEqual({ baseline: "base" })
    expect(strict(ServicesConfig)({})).toEqual({ globalPaths: [] })
  })
})

describe("konfig.json schema (T4.1)", () => {
  it("decodes a minimal config with defaults filled in", () => {
    const cfg = decode({
      root: "infra/k8s-konfig",
      envs: { prod: { entry: "env/prod.ts" } },
      outDir: { manifests: "manifests" }
    })

    expect(cfg.root).toBe("infra/k8s-konfig")
    expect(cfg.cluster).toBe("cluster.ts")
    expect(cfg.modules).toBe("modules")
    expect(cfg.charts).toBe("infra/k8s-konfig/charts")
    expect(cfg.crd?.outDir).toBe(".generated/crd")
    expect(cfg.helm?.cacheDir).toBe(".konfig/helm-cache")
    expect(cfg.helm?.minVersion).toBe("3.16.0")
    expect(cfg.envs.prod?.entry).toBe("env/prod.ts")
  })

  it("decodes a fully-populated config with all optional sections", () => {
    const cfg = decode({
      root: "infra/k8s-konfig",
      envs: {
        prod: { entry: "env/prod.ts" },
        staging: { entry: "env/staging.ts" },
        local: { entry: "env/local.ts" },
        preview: { entry: "env/preview.ts" }
      },
      outDir: { manifests: "manifests" },
      crd: { outDir: ".generated/crd" },
      helm: { cacheDir: "../../.konfig/helm-cache" },
      diff: { baseline: "../k8s/manifests" },
      services: {
        outFile: "../apps.konfig.json",
        globalPaths: ["shared/**", "package.json", "bun.lock", "tsconfig.base.json"]
      }
    })

    expect(cfg.helm?.cacheDir).toBe("../../.konfig/helm-cache")
    expect(cfg.helm?.minVersion).toBe("3.16.0")
    expect(cfg.diff?.baseline).toBe("../k8s/manifests")
    expect(cfg.services?.outFile).toBe("../apps.konfig.json")
    expect(cfg.services?.globalPaths?.length).toBe(4)
  })

  it("rejects unknown top-level keys (FR-8.5)", () => {
    expect(() =>
      decode({
        root: "infra/k8s-konfig",
        envs: { prod: { entry: "env/prod.ts" } },
        outDir: { manifests: "manifests" },
        extraKey: "rejected"
      })
    ).toThrow()
  })

  it("requires `root`, `envs`, `outDir.manifests`", () => {
    expect(() => decode({ envs: {}, outDir: { manifests: "x" } })).toThrow()
    expect(() => decode({ root: "x", outDir: { manifests: "x" } })).toThrow()
    expect(() => decode({ root: "x", envs: {} })).toThrow()
  })
})
