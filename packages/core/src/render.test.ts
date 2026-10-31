import { NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Context, Effect, Layer } from "effect"
import { describe, expect } from "vitest"
import * as Manifest from "./Manifest"
import { _buildLayers, _compose, render, renderAllYaml } from "./render"
import type { RenderContext } from "./RenderContext"

describe("renderAllYaml — skipped manifests", () => {
  it("skips a manifest rendering undefined instead of crashing", async () => {
    const skipped = Manifest.make(() => undefined)
    const kept = Manifest.make(() => ({ kind: "B" }))
    const out = await renderAllYaml({ manifests: [skipped, kept] })
    expect(out).toBe("kind: B\n")
  })

  it("skips Manifest.whenever with a false condition", async () => {
    const skipped = Manifest.whenever({ cond: false, thunk: () => Manifest.make(() => ({ kind: "A" })) })
    const kept = Manifest.make(() => ({ kind: "B" }))
    const out = await renderAllYaml({ manifests: [skipped, kept] })
    expect(out).toBe("kind: B\n")
  })
})

describe("render — layer composition", () => {
  it("returns NodeServices.layer alone when no extra layer is provided", () => {
    expect(_buildLayers(undefined)).toBe(NodeServices.layer)
  })

  it.effect("merges NodeServices.layer with the caller's layer when provided", () => {
    const Marker = Context.Service<{ readonly tag: "marker" }>("test/render/Marker")
    const built = _buildLayers(Layer.succeed(Marker, { tag: "marker" } as const))
    expect(built).not.toBe(NodeServices.layer)

    return Effect.gen(function*() {
      const m = yield* Marker
      expect(m.tag).toBe("marker")
    }).pipe(Effect.provide(built))
  })
})

describe("render — _compose wiring", () => {
  it.effect("hands the program a ctx keyed on the resolved env and the merged layers", () => {
    const Marker = Context.Service<{ readonly tag: "marker" }>("test/render/ComposeMarker")
    const extra = Layer.succeed(Marker, { tag: "marker" } as const)
    const seen = { env: "", tag: "" }

    const program = (ctx: RenderContext) =>
      Effect.gen(function*() {
        const m = yield* Marker
        seen.env = ctx.env
        seen.tag = m.tag
      })

    return _compose({ program, options: { env: "staging", layers: extra } }).pipe(
      Effect.map(() => {
        expect(seen).toEqual({ env: "staging", tag: "marker" })
      })
    )
  })

  it.effect("defaults the composed ctx env to 'prod' when no env option is given", () => {
    const seen = { env: "" }

    const program = (ctx: RenderContext) =>
      Effect.sync(() => {
        seen.env = ctx.env
      })

    return _compose({ program }).pipe(Effect.map(() => expect(seen.env).toBe("prod")))
  })
})

describe("render", () => {
  it.effect("hands the composed program to the runMain override", () => {
    const seen = { env: "" }
    const ran: Array<Effect.Effect<void>> = []

    render({
      program: (ctx) =>
        Effect.sync(() => {
          seen.env = ctx.env
        }),
      options: { env: "preview", runMain: (effect) => ran.push(effect) }
    })

    expect(ran).toHaveLength(1)

    return Effect.gen(function*() {
      yield* ran[0]!
      expect(seen.env).toBe("preview")
    })
  })
})
