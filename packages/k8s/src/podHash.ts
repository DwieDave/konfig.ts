import { Redacted } from "effect";
import { createHash } from "node:crypto";

export interface HashSecretValuesInput {
	readonly values: Readonly<Record<string, Redacted.Redacted<string>>>;
	readonly length?: number;
}

// Captures values AT BUILD TIME ONLY — rotations between builds need an
// in-cluster watcher (e.g. Reloader). Redacted.value is inline so plaintext
// is not bound to a local.
export const hashSecretValues = (input: HashSecretValuesInput): string => {
	const length = input.length ?? 16;
	const hasher = createHash("sha256");
	const keys = Object.keys(input.values).sort();
	for (const key of keys) {
		hasher.update(key);
		hasher.update("=");
		hasher.update(Redacted.value(input.values[key]!));
		hasher.update("\n");
	}
	return hasher.digest("hex").slice(0, length);
};
