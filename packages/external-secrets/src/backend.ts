import { Manifest } from "@konfig.ts/core";
import type { BackendEmitInput, SecretBackend } from "@konfig.ts/k8s";
import { Effect } from "effect";
import type {
	ExternalSecret,
	ExternalSecretDataEntry,
	ExternalSecretRemoteRef,
	ExternalSecretTarget,
	SecretStoreRef,
} from "./crd";

export interface ExternalSecretsBackendOptions<K extends string> {
	readonly secretStoreRef: SecretStoreRef;
	readonly refreshInterval?: string;
	readonly remoteRef?: (key: K) => Omit<ExternalSecretRemoteRef, never>;
	readonly target?: ExternalSecretTarget;
}

interface _EmitInput<N extends string, K extends string> {
	readonly base: BackendEmitInput<N, K>;
	readonly opts: ExternalSecretsBackendOptions<K>;
}

const _identityRemoteRef = <K extends string>(key: K): ExternalSecretRemoteRef => ({ key });

const _emit = <N extends string, K extends string>(
	input: _EmitInput<N, K>,
): Manifest.Manifest<ExternalSecret> =>
	Manifest.make<ExternalSecret>((_ctx) =>
		Effect.sync(() => {
			const remoteRef = input.opts.remoteRef ?? _identityRemoteRef;
			const data: ExternalSecretDataEntry[] = input.base.keys.map((key) => ({
				secretKey: key,
				remoteRef: remoteRef(key),
			}));
			const out: ExternalSecret = {
				apiVersion: "external-secrets.io/v1beta1",
				kind: "ExternalSecret",
				metadata: {
					name: input.base.name,
					namespace: input.base.namespace,
					labels: input.base.labels,
					annotations: input.base.annotations,
				},
				spec: {
					refreshInterval: input.opts.refreshInterval,
					secretStoreRef: {
						name: input.opts.secretStoreRef.name,
						kind: input.opts.secretStoreRef.kind ?? "SecretStore",
					},
					target: input.opts.target,
					data,
				},
			};
			return out;
		}),
	);

export const ExternalSecrets = {
	backend: <N extends string, K extends string>(
		opts: ExternalSecretsBackendOptions<K>,
	): SecretBackend<N, K> => ({
		_tag: "ExternalSecrets",
		requiresSource: false,
		emit: (input: BackendEmitInput<N, K>) => _emit({ base: input, opts }),
	}),
};
