import { Effect, Predicate, Schema } from "effect"
import { FileSystem } from "effect/FileSystem"
import type { Path } from "effect/Path"
import type { ChildProcessSpawner } from "effect/process/ChildProcessSpawner"
import type * as Scope from "effect/Scope"
import { unsafeCoerce } from "./_cast"
import { isRecord } from "./guards"
import { liftEffect } from "./lift"
import type { RenderContext } from "./RenderContext"
import { type AnyRenderError, EmbedYamlReadError } from "./RenderError"

export type RenderServices = FileSystem | Path | ChildProcessSpawner | Scope.Scope

export const ManifestTypeId: unique symbol = Symbol.for("@konfig.ts/core/Manifest")

export type ManifestTypeId = typeof ManifestTypeId

interface Variance<out A> {
  readonly _A: (_: never) => A
}

export interface Manifest<out A> {
  readonly [ManifestTypeId]: Variance<A>
  readonly render: (ctx: RenderContext) => Effect.Effect<A, AnyRenderError, RenderServices>
}

export const isManifest = (u: unknown): u is Manifest<unknown> => isRecord(u) && ManifestTypeId in u

const variance: Variance<never> = {
  _A: (_: never) => _
}

export type MakeRun<A> = (
  ctx: RenderContext
) => A | Effect.Effect<A, AnyRenderError, RenderServices>

export const make = <A>(run: MakeRun<A>): Manifest<A> => ({
  [ManifestTypeId]: unsafeCoerce<Variance<A>>({
    value: variance,
    reason: "phantom variance witness — A only appears in covariant position"
  }),
  render: (ctx) => liftEffect<A, AnyRenderError, RenderServices>(run(ctx))
})

export const RENDER_CONCURRENCY = 4

export interface CombineInput<A1, A2> {
  readonly a: Manifest<A1>
  readonly b: Manifest<A2>
}

export const combine = <A1, A2>(input: CombineInput<A1, A2>): Manifest<readonly [A1, A2]> =>
  make((ctx) => Effect.all([input.a.render(ctx), input.b.render(ctx)], { concurrency: RENDER_CONCURRENCY }))

// `concat` tells apart a Manifest<A> from a Manifest<A[]> at render time with
// `Array.isArray`, so A must not itself be an array type — Manifest<string[]>
// would be indistinguishable from Manifest<string[][]>'s per-element A. The
// `IsArray<A>` branch below rejects an array-typed A at the call site
// (`never` accepts no manifest) instead of silently over-flattening it.
type IsArray<A> = A extends readonly unknown[] ? true : false

export const concat = <A>(
  ...manifests: (IsArray<A> extends true ? never : Manifest<A | A[]>)[]
): Manifest<A[]> =>
  make((ctx) =>
    Effect.forEach(manifests, (m) => m.render(ctx), { concurrency: RENDER_CONCURRENCY }).pipe(
      Effect.map((results) => results.flatMap((r) => (Array.isArray(r) ? r : [r])))
    )
  )

export interface WheneverInput<A> {
  readonly cond: boolean
  readonly thunk: () => Manifest<A>
}

// The thunk runs only when cond holds, so a disabled branch is never built.
export const whenever = <A>(input: WheneverInput<A>): Manifest<A | undefined> =>
  make((ctx) => input.cond ? input.thunk().render(ctx) : Effect.undefined)

export type EmbedYamlSource = { readonly path: string } | { readonly literal: string }

export const RawYaml = Schema.TaggedStruct("RawYaml", {
  content: Schema.String,
  origin: Schema.optionalKey(Schema.String)
})

export type RawYaml = typeof RawYaml.Type

// One already-parsed YAML document. `Helm.release` emits these instead of
// RawYaml so the build path serializes each doc exactly once instead of
// stringify → re-parse → re-serialize.
export const ParsedDoc = Schema.TaggedStruct("ParsedDoc", {
  value: Schema.Unknown,
  origin: Schema.optionalKey(Schema.String)
})

export type ParsedDoc = typeof ParsedDoc.Type

export const isRawYaml = (u: unknown): u is RawYaml =>
  Predicate.isTagged(u, "RawYaml") && Predicate.hasProperty(u, "content") && Predicate.isString(u.content)

export const isParsedDoc = (u: unknown): u is ParsedDoc =>
  Predicate.isTagged(u, "ParsedDoc") && Predicate.hasProperty(u, "value")

export const embedYaml = (source: EmbedYamlSource): Manifest<RawYaml> =>
  make<RawYaml>((_ctx) => {
    if ("literal" in source) {
      return Effect.succeed<RawYaml>(RawYaml.make({ content: source.literal }))
    }

    const path = source.path

    return Effect.gen(function*() {
      const fs = yield* FileSystem
      const content = yield* fs.readFileString(path)

      return RawYaml.make({ content, origin: path })
    }).pipe(Effect.mapError((cause) => new EmbedYamlReadError({ path, cause })))
  })
