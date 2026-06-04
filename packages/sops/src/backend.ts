import { boundary, Manifest, RenderError, Yaml } from "@konfig.ts/core";
import type { SecretSource } from "@konfig.ts/env";
import { BackendSourceMissing, type BackendEmitInput, type SecretBackend } from "@konfig.ts/k8s";
import { Effect, Redacted } from "effect";
import { FileSystem } from "effect/FileSystem";
import * as YAML from "yaml";
import type { SopsRecipients, SopsSecret } from "./crd";
import { SopsRecipientsSchema, SopsSecretSchema } from "./schema";
import { sopsEncryptStdin } from "./sops";

const _decodeSopsSecret = boundary({
	schema: SopsSecretSchema,
	label: "SopsSecret",
});

const _decodeRecipients = boundary({
	schema: SopsRecipientsSchema,
	label: "SopsRecipients",
});

export interface SopsBackendOptions {
	readonly recipients: SopsRecipients;
	readonly type?: string;
}

interface _EmitInput<N extends string, K extends string> {
	readonly base: BackendEmitInput<N, K>;
	readonly source: SecretSource<K, Manifest.RenderServices>;
	readonly opts: SopsBackendOptions;
}

const _emit = <N extends string, K extends string>(
	input: _EmitInput<N, K>,
): Manifest.Manifest<SopsSecret> =>
	Manifest.make<SopsSecret>((_ctx) =>
		Effect.gen(function* () {
			const resolved = yield* input.source.resolve.pipe(
				Effect.mapError(
					(cause) =>
						new RenderError({
							message: `Sops(${input.base.namespace}/${input.base.name}): source failed for key "${cause.key}"`,
							cause,
						}),
				),
			);
			const stringData: Record<string, string> = {};
			for (const key of input.base.keys) {
				stringData[key] = Redacted.value(resolved[key]);
			}
			const plainCR = {
				apiVersion: "isindir.github.com/v1alpha3" as const,
				kind: "SopsSecret" as const,
				metadata: {
					name: input.base.name,
					namespace: input.base.namespace,
					labels: input.base.labels,
					annotations: input.base.annotations,
				},
				spec: {
					secretTemplates: [
						{
							name: input.base.name,
							type: input.opts.type ?? "Opaque",
							stringData,
						},
					],
				},
			};
			const yaml = Yaml.serialize({ value: plainCR });
			const recipients = yield* _decodeRecipients(input.opts.recipients);
			const encryptedYaml = yield* sopsEncryptStdin({
				plaintextYaml: yaml,
				recipients,
			}).pipe(
				Effect.mapError(
					(cause) =>
						new RenderError({
							message: `Sops(${input.base.namespace}/${input.base.name}): sops --encrypt failed`,
							cause,
						}),
				),
			);
			const parsed = yield* Effect.try({
				try: () => YAML.parse(encryptedYaml) as unknown,
				catch: (cause) =>
					new RenderError({
						message: `Sops(${input.base.namespace}/${input.base.name}): sops stdout was not valid YAML`,
						cause,
					}),
			});
			return yield* _decodeSopsSecret(parsed);
		}),
	);

interface _PassthroughInput<N extends string, K extends string> {
	readonly base: BackendEmitInput<N, K>;
	readonly file: string;
}

const _passthrough = <N extends string, K extends string>(
	input: _PassthroughInput<N, K>,
): Manifest.Manifest<SopsSecret> =>
	Manifest.make<SopsSecret>((_ctx) =>
		Effect.gen(function* () {
			const fs = yield* FileSystem;
			const contents = yield* fs
				.readFileString(input.file)
				.pipe(
					Effect.mapError(
						(cause) =>
							new RenderError({
								message: `Sops.passthrough(${input.base.namespace}/${input.base.name}): could not read ${input.file}`,
								cause,
							}),
					),
				);
			const parsed = yield* Effect.try({
				try: () => YAML.parse(contents) as unknown,
				catch: (cause) =>
					new RenderError({
						message: `Sops.passthrough(${input.base.namespace}/${input.base.name}): file ${input.file} was not valid YAML`,
						cause,
					}),
			});
			return yield* _decodeSopsSecret(parsed);
		}),
	);

import { SopsSource } from "./source";

export const Sops = {
	source: SopsSource.source,
	backend: <N extends string, K extends string>(
		opts: SopsBackendOptions,
	): SecretBackend<N, K> => ({
		_tag: "Sops",
		requiresSource: true,
		emit: (input: BackendEmitInput<N, K>) => {
			if (input.source === undefined) {
				throw new BackendSourceMissing({ backend: "Sops", secret: input.name });
			}
			return _emit({ base: input, source: input.source, opts });
		},
	}),
	passthrough: <N extends string, K extends string>(opts: {
		readonly file: string;
	}): SecretBackend<N, K> => ({
		_tag: "Sops.passthrough",
		requiresSource: false,
		emit: (input: BackendEmitInput<N, K>) => _passthrough({ base: input, file: opts.file }),
	}),
};
