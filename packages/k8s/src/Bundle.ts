import type { AnyRenderError } from "@konfig.ts/core";
import { Dep } from "@konfig.ts/core";
import type { Context, Layer } from "effect";

export interface Bundle {
	readonly name: string;
	readonly namespace?: string;
	readonly manifests: ReadonlyArray<unknown>;
}

export interface BundleMakeOptions {
	readonly name: string;
	readonly namespace?: string;
	readonly manifests: ReadonlyArray<unknown>;
}

export const make = (opts: BundleMakeOptions): Bundle => ({
	name: opts.name,
	manifests: opts.manifests,
	...(opts.namespace !== undefined ? { namespace: opts.namespace } : {}),
});

/**
 * Handle returned by `Bundle.define`. Same yieldable-Context-Tag +
 * `.layer` pattern as argocd's `ApplicationHandle`; only the carried
 * value type differs (a plain `Bundle` with no argo source/syncPolicy).
 * `Dep.Need<"App", Name>` keys the dep graph by literal name so
 * sibling modules can `yield* bundleHandle` to consume it.
 */
export interface BundleHandle<Name extends string, Out, In>
	extends Context.Service<Dep.Need<"App", Name>, Bundle> {
	readonly layer: Layer.Layer<Out, AnyRenderError, In>;
}

/**
 * Resolves to `T` if it is a string literal (or template-literal pattern),
 * and to a branded error type if it is the bare `string` widening. Mirrors
 * `Application.LiteralName` in spirit — konfig's dep graph keys every
 * `Provide<"App", Name>` slot by literal `Name`, and a wrapper that lets
 * `Name` widen to `string` collapses every bundle into the same slot.
 */
export type LiteralName<T extends string> = string extends T
	? {
			readonly _konfig_error: "Bundle name/namespace must be a string literal. Make the wrapper generic (`<const Name extends string>`) and forward via `Bundle.LiteralName<Name>`.";
		}
	: T;
