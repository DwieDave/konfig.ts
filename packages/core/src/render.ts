import type { Effect } from "effect";
import type { Manifest, RenderServices } from "./Manifest";
import type { RenderContext } from "./RenderContext";
import type { AnyRenderError } from "./RenderError";

// Render a Manifest. M9 dropped the `R extends Empty` gate — dep
// satisfaction is now enforced at the surrounding Effect program's
// `R = never` check via `Effect.runPromise`.
export const render = <A>(
	manifest: Manifest<A>,
	ctx: RenderContext,
): Effect.Effect<A, AnyRenderError, RenderServices> => manifest.render(ctx);
