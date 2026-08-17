import { describe, expect, it } from "vitest"
import { cacheFileName } from "./Helm"

describe("Helm.cacheFileName", () => {
  it("uses the plain <chart>-<version>.tgz form when no digest is given", () => {
    expect(cacheFileName({ chart: "postgresql", version: "16.0.0" })).toBe("postgresql-16.0.0.tgz")
  })

  it("appends a 12-char digest suffix when a digest is given", () => {
    const digest = `sha256:${"a".repeat(64)}`
    expect(cacheFileName({ chart: "postgresql", version: "16.0.0", digest })).toBe(
      `postgresql-16.0.0-${"a".repeat(12)}.tgz`
    )
  })

  it("accepts a digest with no sha256: prefix", () => {
    const digest = "b".repeat(64)
    expect(cacheFileName({ chart: "redis", version: "1.0.0", digest })).toBe(`redis-1.0.0-${"b".repeat(12)}.tgz`)
  })

  it("truncates the digest suffix to 12 hex chars regardless of the full digest length", () => {
    const digest = `sha256:${"0123456789abcdef".repeat(4)}`
    expect(cacheFileName({ chart: "mychart", version: "2.0.0", digest })).toBe(
      "mychart-2.0.0-0123456789ab.tgz"
    )
  })
})
