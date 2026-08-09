import { NodeServices } from "@effect/platform-node"
import { expect, layer } from "@effect/vitest"
import { Effect } from "effect"
import { FileSystem } from "effect/FileSystem"
import { Path } from "effect/Path"
import * as Manifest from "./Manifest"
import { RenderContext } from "./RenderContext"
import { EmbedYamlReadError } from "./RenderError"

layer(NodeServices.layer)("Manifest combinators", (it) => {
  const ctx = RenderContext.make("test")

  it.effect("combine pairs two manifests' rendered values into a tuple", () =>
    Effect.gen(function*() {
      const a = Manifest.make<number>(() => 1)
      const b = Manifest.make<string>(() => "x")
      const combined = Manifest.combine({ a, b })
      const result = yield* combined.render(ctx)
      expect(result).toEqual([1, "x"])
    }))

  it.effect("concat flattens array-returning and scalar-returning manifests together", () =>
    Effect.gen(function*() {
      const arrayManifest = Manifest.make<number[]>(() => [1, 2])
      const scalarManifest = Manifest.make<number>(() => 3)
      const result = yield* Manifest.concat(arrayManifest, scalarManifest).render(ctx)
      expect(result).toEqual([1, 2, 3])
    }))

  it.effect("concat with no manifests renders an empty array", () =>
    Effect.gen(function*() {
      const result = yield* Manifest.concat<number>().render(ctx)
      expect(result).toEqual([])
    }))

  it("concat rejects an array-typed A at compile time (element type would be ambiguous)", () => {
    const nested = Manifest.make<number[][]>(() => [[1, 2], [3]])
    // @ts-expect-error — A = number[] is itself an array type, so
    // Manifest<number[]> and Manifest<number[][]>'s per-element A are
    // indistinguishable via Array.isArray; concat's type rejects this call.
    Manifest.concat(nested)
  })

  it.effect("whenever runs the thunk and its manifest when cond is true", () =>
    Effect.gen(function*() {
      let called = false
      const m = Manifest.whenever({
        cond: true,
        thunk: () =>
          Manifest.make<string>(() => {
            called = true
            return "made"
          })
      })
      const result = yield* m.render(ctx)
      expect(called).toBe(true)
      expect(result).toBe("made")
    }))

  it.effect("whenever skips the thunk and yields undefined when cond is false", () =>
    Effect.gen(function*() {
      let called = false
      const m = Manifest.whenever<string>({
        cond: false,
        thunk: () =>
          Manifest.make<string>(() => {
            called = true
            return "made"
          })
      })
      const result = yield* m.render(ctx)
      expect(called).toBe(false)
      expect(result).toBeUndefined()
    }))

  it.effect("embedYaml with a literal source returns its content with no origin", () =>
    Effect.gen(function*() {
      const m = Manifest.embedYaml({ literal: "kind: ConfigMap\n" })
      const result = yield* m.render(ctx)
      expect(result).toEqual({ _tag: "RawYaml", content: "kind: ConfigMap\n" })
      expect(result.origin).toBeUndefined()
    }))

  it.effect("embedYaml with a path source reads the file and stamps its origin", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const path = yield* Path
      const dir = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-embedyaml-" })
      const file = path.join(dir, "raw.yaml")
      yield* fs.writeFileString(file, "kind: Secret\n")

      const m = Manifest.embedYaml({ path: file })
      const result = yield* m.render(ctx)
      expect(result.content).toBe("kind: Secret\n")
      expect(result.origin).toBe(file)
    }).pipe(Effect.scoped))

  it.effect("embedYaml with a missing path fails with EmbedYamlReadError", () =>
    Effect.gen(function*() {
      const missing = "/nonexistent/does-not-exist.yaml"
      const m = Manifest.embedYaml({ path: missing })
      const failure = yield* m.render(ctx).pipe(Effect.flip)
      expect(failure).toBeInstanceOf(EmbedYamlReadError)
      if (failure instanceof EmbedYamlReadError) {
        expect(failure.path).toBe(missing)
      }
    }))
})
