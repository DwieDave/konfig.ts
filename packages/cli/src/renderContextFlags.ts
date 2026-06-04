import { RenderContext } from "@konfig.ts/core";
import { Option } from "effect";
import { Flag } from "./_unstable";

export const renderContextFlags = {
	cluster: Flag.string("cluster").pipe(
		Flag.withDescription("Target cluster name (when one env spans multiple clusters)"),
		Flag.optional,
	),
	k8sVersion: Flag.string("k8s-version").pipe(
		Flag.withDescription("Target Kubernetes version (e.g. 1.31); shapes apiVersion picks"),
		Flag.optional,
	),
	flag: Flag.keyValuePair("flag").pipe(
		Flag.withDescription("Free-form k=v flags read via ctx.flags.get(k)"),
		Flag.optional,
	),
} as const;

export interface RenderContextFlagValues {
	readonly cluster: Option.Option<string>;
	readonly k8sVersion: Option.Option<string>;
	readonly flag: Option.Option<Record<string, string>>;
}

export const renderContextFromFlags = (
	env: string,
	flags: RenderContextFlagValues,
): RenderContext => {
	const flagMap = Option.match(flags.flag, {
		onSome: (record) => new Map<string, unknown>(Object.entries(record)),
		onNone: () => undefined,
	});
	return RenderContext.makeFull({
		env,
		cluster: Option.getOrUndefined(flags.cluster),
		k8sVersion: Option.getOrUndefined(flags.k8sVersion),
		flags: flagMap,
	});
};
