import { it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { describe, expect } from "vitest"
import { BuiltImageRef, Image, provideImage } from "./deps"

describe("BuiltImageRef + Dep.Image", () => {
  it("BuiltImageRef.of stringifies as 'registry/app:tag'", () => {
    const ref = BuiltImageRef.of({ app: "api", registry: "ghcr.io/example", tag: "1.0.0" })
    expect(ref).toBe("ghcr.io/example/api:1.0.0")
  })

  it.effect("provideImage yields the typed ref via Dep.Image(app)", () =>
    Effect.gen(function*() {
      const layer = provideImage({ app: "api", registry: "ghcr.io/example", tag: "1.0.0" })

      const result = yield* Image("api").pipe(Effect.provide(layer))
      expect(result).toBe("ghcr.io/example/api:1.0.0")
    }))

  it.effect("an Image-using workload is satisfied when the build module's layer is merged", () =>
    Effect.gen(function*() {
      const buildLayer = provideImage({
        app: "worker",
        registry: "ghcr.io/example",
        tag: "2.3.4"
      })

      const result = yield* Image("worker").pipe(
        Effect.map((ref) => ({ image: String(ref) })),
        Effect.provide(buildLayer)
      )
      expect(result.image).toBe("ghcr.io/example/worker:2.3.4")
    }))

  it.effect("Layer.mergeAll composes image providers", () => {
    const apiLayer = provideImage({ app: "api", registry: "ghcr.io/x", tag: "1" })
    const workerLayer = provideImage({ app: "worker", registry: "ghcr.io/x", tag: "1" })

    return Effect.gen(function*() {
      const api = yield* Image("api")
      const worker = yield* Image("worker")
      expect(String(api)).toBe("ghcr.io/x/api:1")
      expect(String(worker)).toBe("ghcr.io/x/worker:1")
    }).pipe(Effect.provide(Layer.mergeAll(apiLayer, workerLayer)))
  })
})
