import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { RenderContext } from "./RenderContext";

export interface RenderOptions<RIn = never> {
	readonly env?: string;
	readonly layers?: Layer.Layer<RIn, never, never>;
}

/** @internal */
export const _resolveEnv = (env: string | undefined): string => env ?? "prod";

/** @internal */
export const _buildLayers = <RIn>(
	extra: Layer.Layer<RIn, never, never> | undefined,
): Layer.Layer<NodeServices.NodeServices | RIn, never, never> =>
	extra === undefined
		? // oxlint-disable-next-line app/no-type-assertion
			(NodeServices.layer as Layer.Layer<NodeServices.NodeServices | RIn, never, never>)
		: Layer.mergeAll(NodeServices.layer, extra);

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
	options: RenderOptions<RIn> = {},
): void => {
	const ctx = RenderContext.make(_resolveEnv(options.env));
	const layers = _buildLayers(options.layers);
	NodeRuntime.runMain(program(ctx).pipe(Effect.scoped, Effect.provide(layers)));
};
