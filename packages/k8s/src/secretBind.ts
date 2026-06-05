import { Dep, type Manifest, RenderError, type SecretRef } from "@konfig.ts/core";
import type { SecretEntry, SecretSource } from "@konfig.ts/env";
import { type Context, type Layer, Layer as L, Effect } from "effect";
import type { SecretBackend } from "./backend";
import { EnvVar } from "./env";
import { SecretRef as SecretRefValue } from "./refs";

export interface DeclaredSecret<N extends string, K extends string, Ns extends string = string> {
	readonly ref: SecretRef<N, K, Ns>;
	readonly name: N;
	readonly namespace: Ns;
	readonly keys: ReadonlyArray<K>;
	readonly envVars: ReadonlyArray<EnvVar>;
	readonly manifest?: Manifest.Manifest<unknown>;
	readonly refLayer: Layer.Layer<Dep.Provide<"Secret", N>>;
	// values + layer present iff a source was supplied at bind time.
	readonly values?: Context.Service<
		Dep.Need<"SecretValues", N>,
		Dep.SecretValuesRecord<K>
	>;
	readonly layer?: Layer.Layer<
		Dep.Provide<"SecretValues", N>,
		RenderError,
		Manifest.RenderServices
	>;
}

export interface BindSecretInput<
	N extends string,
	K extends string,
	E extends Readonly<Record<K, string>>,
	Ns extends string = string,
> {
	readonly secret: SecretEntry<N, K, E>;
	readonly backend?: SecretBackend<N, K>;
	readonly source?: SecretSource<K, Manifest.RenderServices>;
	readonly labels?: Readonly<Record<string, string>>;
	readonly annotations?: Readonly<Record<string, string>>;
	/**
	 * Override the contract's baked-in `namespace` for this bind. Useful
	 * when the same `Secret` declaration is consumed across multiple
	 * k8s namespaces (e.g. prod / staging / local of the same workload)
	 * — the runtime read is namespace-independent, but each binding emits
	 * its manifest into a different namespace.
	 *
	 * When passed as a string literal (via `Environment.bind`'s
	 * `const namespace`), the literal flows into the ref's brand so
	 * `secretEnvForPod` can enforce cross-namespace coherence.
	 */
	readonly namespace?: Ns;
}

export const bindSecret = <
	N extends string,
	K extends string,
	E extends Readonly<Record<K, string>>,
	const Ns extends string = string,
>(
	input: BindSecretInput<N, K, E, Ns>,
): DeclaredSecret<N, K, Ns> => {
	const { secret } = input;
	const namespace = (input.namespace ?? secret.namespace) as Ns;
	const ref = SecretRefValue.of<N, K, Ns>(secret.name);
	const envVars: EnvVar[] = secret.keys.map((key: K) =>
		EnvVar.fromSecret({ name: secret.env[key], ref, key }),
	);
	const refLayer = Dep.provideSecret(secret.name);

	const manifest =
		input.backend === undefined
			? undefined
			: input.backend.emit({
					name: secret.name,
					namespace,
					keys: secret.keys,
					labels: input.labels,
					annotations: input.annotations,
					source: input.source,
				});

	const out: DeclaredSecret<N, K, Ns> = {
		ref,
		name: secret.name,
		namespace,
		keys: secret.keys,
		envVars,
		manifest,
		refLayer,
	};

	if (input.source === undefined) return out;

	const source = input.source;
	const valuesTag = Dep.SecretValues<N, K>(secret.name);
	const layer = L.effect(
		valuesTag,
		source.resolve.pipe(
			Effect.mapError(
				(cause) =>
					new RenderError({
						message: `SecretValues(${secret.namespace}/${secret.name}): source failed for key "${cause.key}"`,
						cause,
					}),
			),
		),
	);
	return { ...out, values: valuesTag, layer };
};
