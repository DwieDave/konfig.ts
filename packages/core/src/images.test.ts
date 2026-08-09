import { Effect, Exit } from "effect"
import { describe, expect, it } from "vitest"
import {
  decodeImagesEffect,
  decodeImagesSync,
  imagesFor,
  ImagesAppMissing,
  ImagesEnvMissing,
  lookupEnv,
  lookupEnvEffect,
  requireImage,
  requireImageEffect
} from "./images"

const RAW = {
  envs: {
    prod: { web: "ghcr.io/acme/web:1.0.0", api: "ghcr.io/acme/api:1.0.0" },
    staging: { web: "ghcr.io/acme/web:staging" }
  }
}

describe("decodeImagesSync / decodeImagesEffect", () => {
  it("round-trips a well-formed config", () => {
    const cfg = decodeImagesSync(RAW)
    expect(cfg.envs.prod?.web).toBe("ghcr.io/acme/web:1.0.0")
    expect(cfg.envs.staging?.web).toBe("ghcr.io/acme/web:staging")
  })

  it("rejects a non-string image value", () => {
    expect(() => decodeImagesSync({ envs: { prod: { web: 123 } } })).toThrow()
  })

  it("rejects unknown top-level keys (strict decode)", () => {
    expect(() => decodeImagesSync({ envs: {}, extra: true })).toThrow()
  })

  it("decodeImagesEffect fails instead of throwing", () => {
    const exit = Effect.runSyncExit(decodeImagesEffect({ envs: { prod: { web: 1 } } }))
    expect(Exit.isFailure(exit)).toBe(true)
  })

  it("decodeImagesEffect succeeds for a valid config", () => {
    const exit = Effect.runSyncExit(decodeImagesEffect(RAW))
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value.envs.prod?.api).toBe("ghcr.io/acme/api:1.0.0")
    }
  })
})

describe("lookupEnv / lookupEnvEffect", () => {
  const cfg = decodeImagesSync(RAW)

  it("returns the env's image map when present", () => {
    const e = lookupEnv({ cfg, env: "prod" })
    expect(e?.web).toBe("ghcr.io/acme/web:1.0.0")
  })

  it("returns undefined for a missing env", () => {
    expect(lookupEnv({ cfg, env: "nope" })).toBeUndefined()
  })

  it("lookupEnvEffect succeeds with the env's image map", () => {
    const result = Effect.runSync(lookupEnvEffect({ cfg, env: "staging" }))
    expect(result.web).toBe("ghcr.io/acme/web:staging")
  })

  it("lookupEnvEffect fails with ImagesEnvMissing for an unknown env", () => {
    const exit = Effect.runSyncExit(lookupEnvEffect({ cfg, env: "nope" }))
    expect(Exit.isFailure(exit)).toBe(true)
    const flipped = Effect.runSync(lookupEnvEffect({ cfg, env: "nope" }).pipe(Effect.flip))
    expect(flipped).toBeInstanceOf(ImagesEnvMissing)
    expect(flipped.env).toBe("nope")
  })
})

describe("imagesFor (throwing variant)", () => {
  const cfg = decodeImagesSync(RAW)

  it("returns the env's image map when present", () => {
    expect(imagesFor({ cfg, env: "prod" }).web).toBe("ghcr.io/acme/web:1.0.0")
  })

  it("throws ImagesEnvMissing for an unknown env", () => {
    expect(() => imagesFor({ cfg, env: "nope" })).toThrow(ImagesEnvMissing)
    try {
      imagesFor({ cfg, env: "nope" })
      throw new Error("expected imagesFor to throw")
    } catch (e) {
      expect(e).toBeInstanceOf(ImagesEnvMissing)
      expect((e as ImagesEnvMissing).env).toBe("nope")
    }
  })
})

describe("requireImage / requireImageEffect", () => {
  const cfg = decodeImagesSync(RAW)
  const prodImages = lookupEnv({ cfg, env: "prod" })!

  it("returns the app's image when present", () => {
    expect(requireImage({ e: prodImages, app: "web", envName: "prod" })).toBe(
      "ghcr.io/acme/web:1.0.0"
    )
  })

  it("throws ImagesAppMissing for an unknown app", () => {
    try {
      requireImage({ e: prodImages, app: "worker", envName: "prod" })
      throw new Error("expected requireImage to throw")
    } catch (e) {
      expect(e).toBeInstanceOf(ImagesAppMissing)
      expect((e as ImagesAppMissing).app).toBe("worker")
      expect((e as ImagesAppMissing).env).toBe("prod")
    }
  })

  it("requireImageEffect succeeds with the app's image", () => {
    const result = Effect.runSync(requireImageEffect({ e: prodImages, app: "api", envName: "prod" }))
    expect(result).toBe("ghcr.io/acme/api:1.0.0")
  })

  it("requireImageEffect fails with ImagesAppMissing for an unknown app", () => {
    const flipped = Effect.runSync(
      requireImageEffect({ e: prodImages, app: "worker", envName: "prod" }).pipe(Effect.flip)
    )
    expect(flipped).toBeInstanceOf(ImagesAppMissing)
    expect(flipped.app).toBe("worker")
    expect(flipped.env).toBe("prod")
  })
})
