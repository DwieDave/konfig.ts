export interface SopsSecretTemplate {
	readonly name: string;
	readonly type?: string;
	readonly stringData?: Readonly<Record<string, string>>;
	readonly data?: Readonly<Record<string, string>>;
	readonly labels?: Readonly<Record<string, string>>;
	readonly annotations?: Readonly<Record<string, string>>;
}

export interface SopsSecretSpec {
	readonly secretTemplates: ReadonlyArray<SopsSecretTemplate>;
	readonly suspend?: boolean;
}

export interface SopsSecret {
	readonly apiVersion: "isindir.github.com/v1alpha3";
	readonly kind: "SopsSecret";
	readonly metadata: {
		readonly name: string;
		readonly namespace: string;
		readonly labels?: Readonly<Record<string, string>>;
		readonly annotations?: Readonly<Record<string, string>>;
	};
	readonly spec: SopsSecretSpec;
	readonly sops?: Readonly<Record<string, unknown>>;
}

export interface SopsRecipients {
	readonly age?: ReadonlyArray<string>;
	readonly kms?: ReadonlyArray<string>;
	readonly gcpKms?: ReadonlyArray<string>;
	readonly azureKv?: ReadonlyArray<string>;
	readonly pgp?: ReadonlyArray<string>;
}
