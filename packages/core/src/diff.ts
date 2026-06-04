import * as YAML from "yaml";
import { unsafeCoerce } from "./_cast";

const IGNORED_LABEL_KEYS = new Set(["helm.sh/chart"]);
const IGNORED_ANNOTATION_KEYS = new Set([
	"meta.helm.sh/release-name",
	"meta.helm.sh/release-namespace",
]);
const MANAGED_BY_HELM_LABEL = "app.kubernetes.io/managed-by";

const _redactLabelMap = (labels: Record<string, unknown>): Record<string, unknown> => {
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(labels)) {
		if (IGNORED_LABEL_KEYS.has(k)) continue;
		if (k === MANAGED_BY_HELM_LABEL && v === "Helm") continue;
		out[k] = v;
	}
	return out;
};

const _redactAnnotationMap = (annotations: Record<string, unknown>): Record<string, unknown> => {
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(annotations)) {
		if (IGNORED_ANNOTATION_KEYS.has(k)) continue;
		out[k] = v;
	}
	return out;
};

export interface RedactInput {
	readonly value: unknown;
	readonly parentKey?: string | null;
}
export const redact = (input: RedactInput): unknown => {
	const value = input.value;
	const parentKey = input.parentKey ?? null;
	if (Array.isArray(value)) {
		return value.map((v) => redact({ value: v, parentKey: null }));
	}
	if (value !== null && typeof value === "object") {
		const obj = unsafeCoerce<Record<string, unknown>>(value, "typeof === object && !Array.isArray && !== null narrowed above");
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(obj)) {
			if (v === null || v === undefined) continue;
			if (k === "labels" && parentKey === "metadata" && v !== null && typeof v === "object") {
				out[k] = _redactLabelMap(unsafeCoerce(v, "metadata.labels is Record<string, string>"));
				continue;
			}
			if (k === "annotations" && parentKey === "metadata" && v !== null && typeof v === "object") {
				out[k] = _redactAnnotationMap(unsafeCoerce(v, "metadata.annotations is Record<string, string>"));
				continue;
			}
			out[k] = redact({ value: v, parentKey: k });
		}
		return out;
	}
	return value;
};

export interface DeepEqualInput {
	readonly a: unknown;
	readonly b: unknown;
}
export const deepEqual = (input: DeepEqualInput): boolean => {
	const { a, b } = input;
	if (a === b) return true;
	if (a === null || b === null) return false;
	if (typeof a !== typeof b) return false;
	if (Array.isArray(a)) {
		if (!Array.isArray(b) || a.length !== b.length) return false;
		for (let i = 0; i < a.length; i++) {
			if (!deepEqual({ a: a[i], b: b[i] })) return false;
		}
		return true;
	}
	if (typeof a === "object" && typeof b === "object") {
		const ka = Object.keys(unsafeCoerce<object>(a, "typeof === object branch")).sort();
		const kb = Object.keys(unsafeCoerce<object>(b, "typeof === object branch")).sort();
		if (ka.length !== kb.length) return false;
		for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return false;
		for (const k of ka) {
			const av = unsafeCoerce<Record<string, unknown>>(a, "typeof === object branch")[k];
			const bv = unsafeCoerce<Record<string, unknown>>(b, "typeof === object branch")[k];
			if (!deepEqual({ a: av, b: bv })) return false;
		}
		return true;
	}
	return false;
};

export const parseYaml = (text: string): unknown => YAML.parse(text);

export type FileDiff =
	| { readonly _tag: "Same"; readonly file: string }
	| { readonly _tag: "MissingLeft"; readonly file: string }
	| { readonly _tag: "MissingRight"; readonly file: string }
	| {
			readonly _tag: "Changed";
			readonly file: string;
			readonly left: unknown;
			readonly right: unknown;
	  };

export interface DiffResult {
	readonly entries: ReadonlyArray<FileDiff>;
}

export interface DiffFilesInput {
	readonly left: Readonly<Record<string, string>>;
	readonly right: Readonly<Record<string, string>>;
}
export const diffFiles = (input: DiffFilesInput): DiffResult => {
	const { left, right } = input;
	const files = Array.from(new Set([...Object.keys(left), ...Object.keys(right)])).sort();
	const entries: FileDiff[] = [];
	for (const file of files) {
		const hasL = Object.hasOwn(left, file);
		const hasR = Object.hasOwn(right, file);
		if (!hasL) {
			entries.push({ _tag: "MissingLeft", file });
			continue;
		}
		if (!hasR) {
			entries.push({ _tag: "MissingRight", file });
			continue;
		}
		const l = redact({ value: parseYaml(left[file] ?? "") });
		const r = redact({ value: parseYaml(right[file] ?? "") });
		entries.push(
			deepEqual({ a: l, b: r })
				? { _tag: "Same", file }
				: { _tag: "Changed", file, left: l, right: r },
		);
	}
	return { entries };
};

export const hasDifferences = (result: DiffResult): boolean =>
	result.entries.some((e) => e._tag !== "Same");

export type DiffFormat = "summary" | "detail" | "json";

export interface FormatDiffInput {
	readonly result: DiffResult;
	readonly format?: DiffFormat;
}
export const formatDiff = (input: FormatDiffInput): string => {
	const { result } = input;
	const format = input.format ?? "summary";
	if (format === "json") {
		return JSON.stringify(result, null, 2);
	}
	const changes = result.entries.filter((e) => e._tag !== "Same");
	if (changes.length === 0) return "";
	const lines: string[] = [];
	for (const e of changes) {
		if (e._tag === "MissingLeft") lines.push(`+ ${e.file}`);
		else if (e._tag === "MissingRight") lines.push(`- ${e.file}`);
		else lines.push(`~ ${e.file}`);
		if (format === "detail" && e._tag === "Changed") {
			lines.push("  left:");
			lines.push(
				...YAML.stringify(e.left, { lineWidth: 0 })
					.split("\n")
					.map((l) => `    ${l}`),
			);
			lines.push("  right:");
			lines.push(
				...YAML.stringify(e.right, { lineWidth: 0 })
					.split("\n")
					.map((l) => `    ${l}`),
			);
		}
	}
	return lines.join("\n");
};
