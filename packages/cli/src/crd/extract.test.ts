import { NodeServices } from "@effect/platform-node"
import { describe, expect, it, layer } from "@effect/vitest"
import { Effect, Exit } from "effect"
import { CrdInputDecodeError, extractCrdsEffect } from "./extract"

const validOpts = {
  repo: "https://charts.bitnami.com/bitnami",
  chart: "postgresql",
  version: "16.0.0",
  id: "postgres",
  outDir: "/tmp/konfig-test-out",
  cacheDir: "/tmp/konfig-test-cache"
}

layer(NodeServices.layer)("extractCrdsEffect input boundary", (it) => {
  it.effect("rejects shell-metachar chart name before any process is spawned", () =>
    Effect.gen(function*() {
      const exit = yield* Effect.exit(
        extractCrdsEffect({ ...validOpts, chart: "x; touch /tmp/pwned" })
      )
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const failure = exit.cause
        const fails = JSON.stringify(failure)
        expect(fails).toContain("CrdInputDecodeError")
      }
    }))

  it.effect("rejects shell-metachar version", () =>
    Effect.gen(function*() {
      const exit = yield* Effect.exit(
        extractCrdsEffect({ ...validOpts, version: "1.0.0 && rm -rf /" })
      )
      expect(Exit.isFailure(exit)).toBe(true)
    }))

  it.effect("rejects backtick injection in repo", () =>
    Effect.gen(function*() {
      const exit = yield* Effect.exit(
        extractCrdsEffect({
          ...validOpts,
          repo: "https://foo.example.com/`whoami`"
        })
      )
      expect(Exit.isFailure(exit)).toBe(true)
    }))

  it.effect("rejects non-http(s)/oci repo schemes", () =>
    Effect.gen(function*() {
      const exit = yield* Effect.exit(
        extractCrdsEffect({ ...validOpts, repo: "file:///etc/passwd" })
      )
      expect(Exit.isFailure(exit)).toBe(true)
    }))

  it.effect("rejects newline injection in chart name", () =>
    Effect.gen(function*() {
      const exit = yield* Effect.exit(
        extractCrdsEffect({ ...validOpts, chart: "postgresql\nrm -rf /" })
      )
      expect(Exit.isFailure(exit)).toBe(true)
    }))
})

describe("CrdInputDecodeError", () => {
  it("is a tagged error class", () => {
    const err = new CrdInputDecodeError({ cause: "bad" })
    expect(err._tag).toBe("CrdInputDecodeError")
    expect(err.message).toContain("CRD extract inputs rejected by schema")
  })
})
