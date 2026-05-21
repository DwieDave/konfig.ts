export type SecretStoreKind = "SecretStore" | "ClusterSecretStore";

export interface SecretStoreRef {
	readonly name: string;
	readonly kind?: SecretStoreKind;
}

export interface ExternalSecretRemoteRef {
	readonly key: string;
	readonly property?: string;
	readonly version?: string;
	readonly conversionStrategy?: "Default" | "Unicode";
	readonly decodingStrategy?: "None" | "Base64" | "Base64URL" | "Auto";
}

export interface ExternalSecretDataEntry {
	readonly secretKey: string;
	readonly remoteRef: ExternalSecretRemoteRef;
}

export type ExternalSecretCreationPolicy = "Owner" | "Orphan" | "Merge" | "None";
export type ExternalSecretDeletionPolicy = "Delete" | "Merge" | "Retain";

export interface ExternalSecretTarget {
	readonly name?: string;
	readonly creationPolicy?: ExternalSecretCreationPolicy;
	readonly deletionPolicy?: ExternalSecretDeletionPolicy;
	readonly immutable?: boolean;
}

export interface ExternalSecretSpec {
	readonly refreshInterval?: string;
	readonly secretStoreRef: SecretStoreRef;
	readonly target?: ExternalSecretTarget;
	readonly data?: ReadonlyArray<ExternalSecretDataEntry>;
}

export interface ExternalSecret {
	readonly apiVersion: "external-secrets.io/v1beta1";
	readonly kind: "ExternalSecret";
	readonly metadata: {
		readonly name: string;
		readonly namespace: string;
		readonly labels?: Readonly<Record<string, string>>;
		readonly annotations?: Readonly<Record<string, string>>;
	};
	readonly spec: ExternalSecretSpec;
}
