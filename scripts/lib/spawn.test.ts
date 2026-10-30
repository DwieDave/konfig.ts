import { NodeServices } from "@effect/platform-node"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { spawnInherit } from "./spawn"

describe("spawnInherit", () => {
  it("yields the child's exit code", async () => {
    const code = await Effect.runPromise(
      spawnInherit({ argv: ["sh", "-c", "exit 3"] }).pipe(Effect.provide(NodeServices.layer))
    )

    expect(code).toBe(3)
  })
})
