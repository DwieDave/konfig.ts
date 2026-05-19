import type { Effect } from "effect";
import type { Manifest, RenderServices } from "./Manifest";
import type { RenderContext } from "./RenderContext";
import type { AnyRenderError } from "./RenderError";

export interface RenderInput<A> {
	readonly manifest: Manifest<A>;
	readonly ctx: RenderContext;
}
export const render = <A>(
	input: RenderInput<A>,
): Effect.Effect<A, AnyRenderError, RenderServices> => input.manifest.render(input.ctx);
