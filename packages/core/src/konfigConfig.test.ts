import { describe, expect, it } from "vitest"
import { decodeKonfigConfigSync } from "./konfigConfig"

const decode = decodeKonfigConfigSync

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
    expect(cfg.charts).toBe("charts")
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
