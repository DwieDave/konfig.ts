import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { Effect, Layer } from "effect"
import { RenderContext } from "./RenderContext"

export interface RenderOptions<RIn = never, E = never> {
  readonly env?: string
  readonly layers?: Layer.Layer<RIn, never, never>
  // Defaults to NodeRuntime.runMain; override in tests to avoid exiting the process.
  readonly runMain?: (effect: Effect.Effect<void, E>) => void
}

export const _resolveEnv = (env: string | undefined): string => env ?? "prod"

export const _buildLayers = <RIn>(
  extra: Layer.Layer<RIn, never, never> | undefined
): Layer.Layer<NodeServices.NodeServices | RIn, never, never> =>
  extra === undefined
    // oxlint-disable-next-line app/no-type-assertion
    ? (NodeServices.layer as Layer.Layer<NodeServices.NodeServices | RIn, never, never>)
    : Layer.mergeAll(NodeServices.layer, extra)

// Extracted so tests can exercise this with Effect.runPromise instead of runMain (which exits).
// oxlint-disable-next-line app/no-multiple-function-params
export const _compose = <E, RIn>(
  program: (ctx: RenderContext) => Effect.Effect<void, E, NodeServices.NodeServices | RIn>,
  options: RenderOptions<RIn> = {}
): Effect.Effect<void, E> => {
  const ctx = RenderContext.make(_resolveEnv(options.env))
  const layers = _buildLayers(options.layers)
  return program(ctx).pipe(Effect.scoped, Effect.provide(layers))
}

// oxlint-disable-next-line app/no-multiple-function-params
export const render = <E, RIn>(
  program: (ctx: RenderContext) => Effect.Effect<void, E, NodeServices.NodeServices | RIn>,
  options: RenderOptions<RIn, E> = {}
): void => {
  const runMain = options.runMain ?? NodeRuntime.runMain
  runMain(_compose(program, options))
}
