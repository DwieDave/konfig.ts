import { Effect, Layer } from "effect"
import { describe, expect, it } from "vitest"
import { BuiltImageRef, Image, provideImage } from "./deps"

describe("BuiltImageRef + Dep.Image", () => {
  it("BuiltImageRef.of stringifies as 'registry/app:tag'", () => {
    const ref = BuiltImageRef.of({ app: "api", registry: "ghcr.io/example", tag: "1.0.0" })
    expect(ref).toBe("ghcr.io/example/api:1.0.0")
  })

  it("provideImage yields the typed ref via Dep.Image(app)", async () => {
    const layer = provideImage({ app: "api", registry: "ghcr.io/example", tag: "1.0.0" })

    const program = Effect.gen(function*() {
      const ref = yield* Image("api")
      return ref
    }).pipe(Effect.provide(layer))

    const result = await Effect.runPromise(program)
    expect(result).toBe("ghcr.io/example/api:1.0.0")
  })

  it("an Image-using workload is satisfied when the build module's layer is merged", async () => {
    const buildLayer = provideImage({
      app: "worker",
      registry: "ghcr.io/example",
      tag: "2.3.4"
    })

    const program = Effect.gen(function*() {
      const ref = yield* Image("worker")
      return { image: String(ref) }
    }).pipe(Effect.provide(buildLayer))

    const result = await Effect.runPromise(program)
    expect(result.image).toBe("ghcr.io/example/worker:2.3.4")
  })

  it("Layer.mergeAll composes image providers", async () => {
    const apiLayer = provideImage({ app: "api", registry: "ghcr.io/x", tag: "1" })
    const workerLayer = provideImage({ app: "worker", registry: "ghcr.io/x", tag: "1" })

    const program = Effect.gen(function*() {
      const api = yield* Image("api")
      const worker = yield* Image("worker")
      return [String(api), String(worker)] as const
    }).pipe(Effect.provide(Layer.mergeAll(apiLayer, workerLayer)))

    const [a, w] = await Effect.runPromise(program)
    expect(a).toBe("ghcr.io/x/api:1")
    expect(w).toBe("ghcr.io/x/worker:1")
  })
})
