import { Effect, type Layer, Predicate } from "effect"
import { unsafeCoerce } from "./_cast"
import type { AnyRenderError } from "./RenderError"

export const liftEffect = <A, E, R>(value: Effect.Effect<A, E, R> | A): Effect.Effect<A, E, R> =>
  Effect.isEffect(value)
    ? value
    : Effect.succeed(unsafeCoerce<A>({ value: value, reason: "a non-Effect input is the success value itself" }))

export const liftBuild = <R>(
  build: Effect.Effect<ReadonlyArray<unknown>, AnyRenderError, R> | (() => ReadonlyArray<unknown>)
): Effect.Effect<ReadonlyArray<unknown>, AnyRenderError, R> =>
  liftEffect<ReadonlyArray<unknown>, AnyRenderError, R>(Predicate.isFunction(build) ? Effect.sync(build) : build)

// Mutate-attach `layer` to the tag so yield* and .layer share one reference.
export const attachLayerToTag = <Tag extends object, Out, Err, In>(
  input: { readonly tag: Tag; readonly layer: Layer.Layer<Out, Err, In> }
): Tag & { readonly layer: Layer.Layer<Out, Err, In> } => Object.assign(input.tag, { layer: input.layer })
