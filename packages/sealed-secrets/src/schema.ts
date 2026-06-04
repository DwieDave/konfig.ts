import { Schema } from "effect";

const _stringRecord = Schema.Record(Schema.String, Schema.String);

export const SealedSecretTemplateSchema = Schema.Struct({
	metadata: Schema.optionalKey(
		Schema.Struct({
			name: Schema.optionalKey(Schema.String),
			namespace: Schema.optionalKey(Schema.String),
			labels: Schema.optionalKey(_stringRecord),
			annotations: Schema.optionalKey(_stringRecord),
		}),
	),
	type: Schema.optionalKey(Schema.String),
	immutable: Schema.optionalKey(Schema.Boolean),
});

export const SealedSecretSpecSchema = Schema.Struct({
	template: Schema.optionalKey(SealedSecretTemplateSchema),
	encryptedData: _stringRecord,
});

export const SealedSecretSchema = Schema.Struct({
	apiVersion: Schema.Literal("bitnami.com/v1alpha1"),
	kind: Schema.Literal("SealedSecret"),
	metadata: Schema.Struct({
		name: Schema.String,
		namespace: Schema.String,
		labels: Schema.optionalKey(_stringRecord),
		annotations: Schema.optionalKey(_stringRecord),
	}),
	spec: SealedSecretSpecSchema,
});
