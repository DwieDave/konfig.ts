import { NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Effect } from "effect"
import { describe, expect } from "vitest"
import { type DockerSpec, HealthcheckAtom } from "../spec"
import { emit } from "./emit"

const FIXTURES = new URL("../../fixtures/", import.meta.url).pathname

const runnerBase = { workdir: "/app/packages/app", copy: [], cmd: ["bun", "x.js"] }

const failureOf = (runner: Partial<DockerSpec["runner"]>) =>
  Effect.flip(emit({
    spec: { runner: { ...runnerBase, ...runner } },
    target: `${FIXTURES}bun/packages/app`,
    specPath: "docker.ts"
  }))

describe("emit spec validation", () => {
  const cases: ReadonlyArray<{ readonly name: string; readonly runner: Partial<DockerSpec["runner"]> }> = [
    { name: "secret-looking env", runner: { env: { STRIPE_KEY: "sk_live_abcdefghijklmnop1234" } } },
    { name: "out-of-range port", runner: { expose: 70000 } },
    {
      name: "healthcheck path without leading slash",
      runner: {
        healthcheck: { ...HealthcheckAtom.cases.HealthcheckHttpGet.make({ path: "/ok", port: 80 }), path: "healthz" }
      }
    }
  ]

  it.effect.each(cases)("$name fails with SpecInvalid", ({ runner }) =>
    Effect.gen(function*() {
      const err = yield* failureOf(runner)
      expect(err._tag).toBe("SpecInvalid")
    }).pipe(Effect.provide(NodeServices.layer)))
})
