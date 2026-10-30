import { NodeServices } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { unsafeCoerce } from "@konfig.ts/core"
import { Effect } from "effect"
import { envEntryPath } from "./envEntry"

const cfg = unsafeCoerce<Parameters<typeof envEntryPath>[0]["cfg"]>({
  value: {
    configDir: "/c",
    config: { root: "r", envs: { prod: { entry: "x/prod.ts" } } }
  },
  reason: "minimal config fixture"
})

const _entry = (envName: string) => envEntryPath({ cfg, envName }).pipe(Effect.provide(NodeServices.layer))

describe("envEntryPath", () => {
  it.effect("uses the declared entry", () =>
    Effect.gen(function*() {
      expect(yield* _entry("prod")).toBe("/c/r/x/prod.ts")
    }))
  it.effect("falls back to env/<name>.ts", () =>
    Effect.gen(function*() {
      expect(yield* _entry("dev")).toBe("/c/r/env/dev.ts")
    }))
})
