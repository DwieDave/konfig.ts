import { NodeServices } from "@effect/platform-node"
import { Context, Effect, Layer } from "effect"
import { describe, expect, it } from "vitest"
import { _buildLayers, _compose, _resolveEnv } from "./render"
import { RenderContext } from "./RenderContext"

describe("render — env resolution", () => {
  it("defaults env to 'prod' when no option is passed", () => {
    expect(_resolveEnv(undefined)).toBe("prod")
  })

  it("uses the provided env when set", () => {
    expect(_resolveEnv("staging")).toBe("staging")
  })

  it("produces a RenderContext from the resolved env", () => {
    const ctx = RenderContext.make(_resolveEnv("preview"))
    expect(ctx.env).toBe("preview")
  })
})

describe("render — layer composition", () => {
  it("returns NodeServices.layer alone when no extra layer is provided", () => {
    const built = _buildLayers(undefined)
    // Layer values are opaque; assert reference identity against NodeServices.layer.
    expect(built).toBe(NodeServices.layer)
  })

  it("merges NodeServices.layer with the caller's layer when provided", async () => {
    const Marker = Context.Service<{ readonly tag: "marker" }>("test/render/Marker")
    const extra = Layer.succeed(Marker, { tag: "marker" } as const)
    const built = _buildLayers(extra)
    expect(built).not.toBe(NodeServices.layer)
    const result = await Effect.runPromise(
      Effect.gen(function*() {
        const m = yield* Marker
        return m.tag
      }).pipe(Effect.provide(built))
    )
    expect(result).toBe("marker")
  })
})

describe("render — _compose wiring", () => {
  it("hands the program a ctx keyed on the resolved env and the merged layers", async () => {
    const Marker = Context.Service<{ readonly tag: "marker" }>("test/render/ComposeMarker")
    const extra = Layer.succeed(Marker, { tag: "marker" } as const)

    let seenEnv: string | undefined
    let seenTag: string | undefined
    const program = (ctx: RenderContext) =>
      Effect.gen(function*() {
        const m = yield* Marker
        seenEnv = ctx.env
        seenTag = m.tag
      })

    // _compose provides NodeServices + the caller's layer, so the program
    // resolves the Marker service and observes the ctx render() would build.
    await Effect.runPromise(_compose(program, { env: "staging", layers: extra }))

    expect(seenEnv).toBe("staging")
    expect(seenTag).toBe("marker")
  })

  it("defaults the composed ctx env to 'prod' when no env option is given", async () => {
    let seenEnv: string | undefined
    const program = (ctx: RenderContext) =>
      Effect.sync(() => {
        seenEnv = ctx.env
      })

    await Effect.runPromise(_compose(program))

    expect(seenEnv).toBe("prod")
  })
})
