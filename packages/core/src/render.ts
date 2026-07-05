import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { Effect, Layer } from "effect"
import { RenderContext } from "./RenderContext"

export interface RenderOptions<RIn = never> {
  /** Render-context env (default `"prod"`). Keys output dirs and bundle entries. */
  readonly env?: string
  /** Extra layer merged with `NodeServices.layer` before running the program. Use for `ConfigProvider` mocks, custom service tags, etc. */
  readonly layers?: Layer.Layer<RIn, never, never>
}

/** @internal */
export const _resolveEnv = (env: string | undefined): string => env ?? "prod"

/** @internal */
export const _buildLayers = <RIn>(
  extra: Layer.Layer<RIn, never, never> | undefined
): Layer.Layer<NodeServices.NodeServices | RIn, never, never> =>
  extra === undefined
    // oxlint-disable-next-line app/no-type-assertion
    ? (NodeServices.layer as Layer.Layer<NodeServices.NodeServices | RIn, never, never>)
    : Layer.mergeAll(NodeServices.layer, extra)

/**
 * @internal
 * Compose the ctx + layers wiring `render` hands to `NodeRuntime.runMain`
 * into a single runnable Effect (context fully provided). Extracted so
 * tests can exercise the composition with `Effect.runPromise` instead of
 * `runMain`, which would exit the process.
 */
// oxlint-disable-next-line app/no-multiple-function-params
export const _compose = <E, RIn>(
  program: (ctx: RenderContext) => Effect.Effect<void, E, NodeServices.NodeServices | RIn>,
  options: RenderOptions<RIn> = {}
): Effect.Effect<void, E> => {
  const ctx = RenderContext.make(_resolveEnv(options.env))
  const layers = _buildLayers(options.layers)
  return program(ctx).pipe(Effect.scoped, Effect.provide(layers))
}

/**
 * Run a render program against `NodeRuntime`.
 *
 * The callback receives a `RenderContext` keyed on `options.env`
 * (default `"prod"`) and returns an Effect whose only required
 * services are `NodeServices` and whatever the caller supplies via
 * `options.layers`. `render` provides both, wraps in `Effect.scoped`,
 * and hands off to `NodeRuntime.runMain`.
 *
 * Replaces the per-file `NodeRuntime.runMain(program.pipe(...))`
 * boilerplate every example used to repeat.
 */
// oxlint-disable-next-line app/no-multiple-function-params
export const render = <E, RIn>(
  program: (ctx: RenderContext) => Effect.Effect<void, E, NodeServices.NodeServices | RIn>,
  options: RenderOptions<RIn> = {}
): void => {
  NodeRuntime.runMain(_compose(program, options))
}
