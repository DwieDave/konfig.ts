// Manifest<A> — a renderable resource. M9 dropped the `R, P` slots:
// dep tracking now lives in Effect's R via yieldable `Dep.*` Keys
// (see `./deps.ts` and `.docs/workflows/tsk-typesafe-k8s/m9-effect-port.md`).
//
// A Manifest is just a wrapper around a render function that produces
// an `A` (typically a k8s resource shape or a RawYaml blob) from a
// RenderContext, with access to the FileSystem / Path /
// ChildProcessSpawner / Scope platform services it might need.

import { Effect } from "effect";
import { FileSystem } from "effect/FileSystem";
import type { Path } from "effect/Path";
import type * as Scope from "effect/Scope";
import type { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner";
import type { RenderContext } from "./RenderContext";
import { type AnyRenderError, EmbedYamlReadError } from "./RenderError";

// Platform services any `Manifest.render` may require at evaluation time.
// `Helm.release` uses FileSystem + Path + ChildProcessSpawner + Scope to
// shell out to `helm`; `embedYaml` (file path variant) uses FileSystem.
export type RenderServices = FileSystem | Path | ChildProcessSpawner | Scope.Scope;

export const ManifestTypeId: unique symbol = Symbol.for("@konfig.ts/core/Manifest");
export type ManifestTypeId = typeof ManifestTypeId;

interface Variance<out A> {
	readonly _A: (_: never) => A;
}

export interface Manifest<out A> {
	readonly [ManifestTypeId]: Variance<A>;
	readonly render: (ctx: RenderContext) => Effect.Effect<A, AnyRenderError, RenderServices>;
}

const variance: Variance<never> = {
	_A: (_: never) => _,
};

// Low-level Manifest constructor. Most code uses `combine`, `embedYaml`,
// etc. rather than this directly.
export const make = <A>(
	run: (ctx: RenderContext) => Effect.Effect<A, AnyRenderError, RenderServices>,
): Manifest<A> => ({
	[ManifestTypeId]: variance as Variance<A>,
	render: run,
});

// Combine two manifests in parallel. Renders both halves concurrently
// and tuples the result. The M9 simplification: no R/P aggregation —
// deps live entirely in the surrounding Effect.gen's R.
export const combine = <A1, A2>(
	a: Manifest<A1>,
	b: Manifest<A2>,
): Manifest<readonly [A1, A2]> =>
	make((ctx) => Effect.all([a.render(ctx), b.render(ctx)], { concurrency: "unbounded" }));

// Concatenate N manifests into a single flat array. Used by Helm
// releases (which produce `RawYaml[]`) to compose into one flat list.
export const concat = <A>(...manifests: Manifest<A | A[]>[]): Manifest<A[]> =>
	make((ctx) =>
		Effect.all(
			manifests.map((m) => m.render(ctx)),
			{ concurrency: "unbounded" },
		).pipe(
			Effect.map((results) => results.flatMap((r) => (Array.isArray(r) ? (r as A[]) : [r as A]))),
		),
	);

// Conditional inclusion — the mkIf analogue. The thunk is only invoked
// when `cond` is true.
export const whenever = <A>(
	cond: boolean,
	thunk: () => Manifest<A>,
): Manifest<A | undefined> =>
	make((ctx) =>
		cond
			? thunk().render(ctx)
			: (Effect.succeed(undefined) as Effect.Effect<A | undefined, AnyRenderError, RenderServices>),
	);

// Source for an embedded raw-YAML blob: either a file path the renderer
// reads at build time, or a literal string already in memory.
export type EmbedYamlSource = { readonly path: string } | { readonly literal: string };

// What the renderer carries for an embed: the resolved YAML text plus
// the origin for filename hints (writers in M3/M4 use `.path` if present).
export interface RawYaml {
	readonly _tag: "RawYaml";
	readonly content: string;
	readonly origin?: string;
}

// Embed verbatim YAML (e.g. a SopsSecret that should pass through
// unchanged). File reads go through Effect's `FileSystem` service so
// the consumer (M4's `konfig build`) controls platform via
// `BunServices.layer`.
export const embedYaml = (source: EmbedYamlSource): Manifest<RawYaml> =>
	make<RawYaml>((_ctx) => {
		if ("literal" in source) {
			return Effect.succeed<RawYaml>({ _tag: "RawYaml", content: source.literal });
		}
		const path = source.path;
		return Effect.gen(function* () {
			const fs = yield* FileSystem;
			const content = yield* fs.readFileString(path);
			return { _tag: "RawYaml" as const, content, origin: path };
		}).pipe(Effect.mapError((cause) => new EmbedYamlReadError({ path, cause })));
	});
