import { Effect, Exit } from "effect"
import { describe, expect, it } from "vitest"
import { CrdInputDecodeError, extractCrdsEffect } from "./extract"

const validOpts = {
  repo: "https://charts.bitnami.com/bitnami",
  chart: "postgresql",
  version: "16.0.0",
  id: "postgres",
  outDir: "/tmp/konfig-test-out",
  cacheDir: "/tmp/konfig-test-cache"
}

describe("extractCrdsEffect input boundary", () => {
  it("rejects shell-metachar chart name before any process is spawned", async () => {
    const exit = await Effect.runPromiseExit(
      extractCrdsEffect({ ...validOpts, chart: "x; touch /tmp/pwned" })
    )
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const failure = exit.cause
      const fails = JSON.stringify(failure)
      expect(fails).toContain("CrdInputDecodeError")
    }
  })

  it("rejects shell-metachar version", async () => {
    const exit = await Effect.runPromiseExit(
      extractCrdsEffect({ ...validOpts, version: "1.0.0 && rm -rf /" })
    )
    expect(Exit.isFailure(exit)).toBe(true)
  })

  it("rejects backtick injection in repo", async () => {
    const exit = await Effect.runPromiseExit(
      extractCrdsEffect({
        ...validOpts,
        repo: "https://foo.example.com/`whoami`"
      })
    )
    expect(Exit.isFailure(exit)).toBe(true)
  })

  it("rejects non-http(s)/oci repo schemes", async () => {
    const exit = await Effect.runPromiseExit(
      extractCrdsEffect({ ...validOpts, repo: "file:///etc/passwd" })
    )
    expect(Exit.isFailure(exit)).toBe(true)
  })

  it("rejects newline injection in chart name", async () => {
    const exit = await Effect.runPromiseExit(
      extractCrdsEffect({ ...validOpts, chart: "postgresql\nrm -rf /" })
    )
    expect(Exit.isFailure(exit)).toBe(true)
  })

  it("CrdInputDecodeError is a tagged error class", () => {
    const err = new CrdInputDecodeError({ cause: "bad" })
    expect(err._tag).toBe("CrdInputDecodeError")
    expect(err.message).toContain("CRD extract inputs rejected by schema")
  })
})
