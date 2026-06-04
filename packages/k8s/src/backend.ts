import type { Manifest } from "@konfig.ts/core";
import type { SecretSource } from "@konfig.ts/env";

export type BackendTag =
	| "Sops"
	| "Sops.passthrough"
	| "SealedSecrets"
	| "ExternalSecrets"
	| "NativeSecret";

export interface BackendEmitInput<N extends string, K extends string> {
	readonly name: N;
	readonly namespace: string;
	readonly keys: ReadonlyArray<K>;
	readonly labels?: Readonly<Record<string, string>>;
	readonly annotations?: Readonly<Record<string, string>>;
	readonly source?: SecretSource<K, Manifest.RenderServices>;
}

export interface SecretBackend<
	N extends string,
	K extends string,
	RequiresSource extends boolean = boolean,
> {
	readonly _tag: BackendTag;
	readonly requiresSource: RequiresSource;
	readonly emit: (input: BackendEmitInput<N, K>) => Manifest.Manifest<unknown>;
}

export class BackendSourceMissing extends Error {
	readonly _tag = "BackendSourceMissing";
	readonly backend: BackendTag;
	readonly secret: string;
	constructor(input: { readonly backend: BackendTag; readonly secret: string }) {
		super(
			`backend "${input.backend}" requires a source but none was provided for secret "${input.secret}"`,
		);
		this.backend = input.backend;
		this.secret = input.secret;
		this.name = "BackendSourceMissing";
	}
}
