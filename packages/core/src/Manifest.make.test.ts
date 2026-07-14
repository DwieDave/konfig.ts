import { NodeServices } from "@effect/platform-node"
import { expect, layer } from "@effect/vitest"
import { Effect } from "effect"
import * as Manifest from "./Manifest"
import { RenderContext } from "./RenderContext"

layer(NodeServices.layer)("Manifest.make", (it) => {
  const ctx = RenderContext.make("test")

  it.effect("accepts an Effect-returning thunk", () =>
    Effect.gen(function*() {
      const m = Manifest.make<{ kind: string }>(() => Effect.succeed({ kind: "X" }))
      const result = yield* m.render(ctx)
      expect(result).toEqual({ kind: "X" })
    }))

  it.effect("accepts a plain value-returning thunk", () =>
    Effect.gen(function*() {
      const m = Manifest.make<{ kind: string }>(() => ({ kind: "X" }))
      const result = yield* m.render(ctx)
      expect(result).toEqual({ kind: "X" })
    }))

  it.effect("treats a returned Effect as the effectful result, not as data", () =>
    Effect.gen(function*() {
      // A nested Effect must not be auto-wrapped — Effect.isEffect detects it.
      const m = Manifest.make<number>(() => Effect.succeed(7))
      const result = yield* m.render(ctx)
      expect(result).toBe(7)
    }))

  it.effect("passes through the render context", () =>
    Effect.gen(function*() {
      const seen: string[] = []
      const m = Manifest.make<string>((c) => {
        seen.push(c.env)
        return c.env
      })
      const result = yield* m.render(ctx)
      expect(seen).toEqual(["test"])
      expect(result).toBe("test")
    }))
})
