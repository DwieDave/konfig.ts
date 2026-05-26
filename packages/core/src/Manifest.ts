
import { Effect } from "effect";
import { FileSystem } from "effect/FileSystem";
import { coerce } from "./_cast";
import type { Path } from "effect/Path";
import type * as Scope from "effect/Scope";
import type { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner";
import type { RenderContext } from "./RenderContext";
import { type AnyRenderError, EmbedYamlReadError } from "./RenderError";

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

export type MakeRun<A> = (
	ctx: RenderContext,
) => A | Effect.Effect<A, AnyRenderError, RenderServices>;

export const make = <A>(run: MakeRun<A>): Manifest<A> => ({
	[ManifestTypeId]: coerce<Variance<A>>(variance),
	render: (ctx) => {
		const result = run(ctx);
		return Effect.isEffect(result)
			? (result as Effect.Effect<A, AnyRenderError, RenderServices>)
			: Effect.succeed(result);
	},
});

export interface CombineInput<A1, A2> {
	readonly a: Manifest<A1>;
	readonly b: Manifest<A2>;
}
export const combine = <A1, A2>(input: CombineInput<A1, A2>): Manifest<readonly [A1, A2]> =>
	make((ctx) => Effect.all([input.a.render(ctx), input.b.render(ctx)], { concurrency: "unbounded" }));

export const concat = <A>(...manifests: Manifest<A | A[]>[]): Manifest<A[]> =>
	make((ctx) =>
		Effect.all(
			manifests.map((m) => m.render(ctx)),
			{ concurrency: "unbounded" },
		).pipe(
			Effect.map((results) =>
				results.flatMap((r) => (Array.isArray(r) ? coerce<A[]>(r) : [coerce<A>(r)])),
			),
		),
	);

export interface WheneverInput<A> {
	readonly cond: boolean;
	readonly thunk: () => Manifest<A>;
}
export const whenever = <A>(input: WheneverInput<A>): Manifest<A | undefined> =>
	make((ctx) =>
		input.cond
			? input.thunk().render(ctx)
			: coerce<Effect.Effect<A | undefined, AnyRenderError, RenderServices>>(
					Effect.succeed(undefined),
				),
	);

export type EmbedYamlSource = { readonly path: string } | { readonly literal: string };

export interface RawYaml {
	readonly _tag: "RawYaml";
	readonly content: string;
	readonly origin?: string;
}

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
