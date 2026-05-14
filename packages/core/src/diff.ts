import * as YAML from "yaml";

// Fields stripped before comparison (FR-3.2). These vary between helm CLI
// builds and don't represent meaningful drift.
const IGNORED_LABEL_KEYS = new Set(["helm.sh/chart"]);
const IGNORED_ANNOTATION_KEYS = new Set([
	"meta.helm.sh/release-name",
	"meta.helm.sh/release-namespace",
]);
// `app.kubernetes.io/managed-by: Helm` is set by `helm template` regardless of
// who invoked it; not meaningful for diffing two render pipelines.
const MANAGED_BY_HELM_LABEL = "app.kubernetes.io/managed-by";

const redactLabelMap = (labels: Record<string, unknown>): Record<string, unknown> => {
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(labels)) {
		if (IGNORED_LABEL_KEYS.has(k)) continue;
		if (k === MANAGED_BY_HELM_LABEL && v === "Helm") continue;
		out[k] = v;
	}
	return out;
};

const redactAnnotationMap = (annotations: Record<string, unknown>): Record<string, unknown> => {
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(annotations)) {
		if (IGNORED_ANNOTATION_KEYS.has(k)) continue;
		out[k] = v;
	}
	return out;
};

// Recursively redact ignored fields. Doesn't touch order or scalar types;
// equality compares maps key-set-and-value, not key insertion order.
export const redact = (value: unknown, parentKey: string | null = null): unknown => {
	if (Array.isArray(value)) {
		return value.map((v) => redact(v, null));
	}
	if (value !== null && typeof value === "object") {
		const obj = value as Record<string, unknown>;
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(obj)) {
			// Drop null/undefined values for diff parity — our YAML serializer
			// strips them (k8s treats `field: null` and "field absent"
			// identically) while helm output sometimes preserves explicit
			// nulls. Normalizing here keeps the structural diff focused on
			// real differences.
			if (v === null || v === undefined) continue;
			if (k === "labels" && parentKey === "metadata" && v !== null && typeof v === "object") {
				out[k] = redactLabelMap(v as Record<string, unknown>);
				continue;
			}
			if (k === "annotations" && parentKey === "metadata" && v !== null && typeof v === "object") {
				out[k] = redactAnnotationMap(v as Record<string, unknown>);
				continue;
			}
			out[k] = redact(v, k);
		}
		return out;
	}
	return value;
};

// Structural deep equality. Maps compare by key-set + recursive value
// equality (insensitive to insertion order). Lists compare positionally —
// order is meaningful (env vars, container args).
export const deepEqual = (a: unknown, b: unknown): boolean => {
	if (a === b) return true;
	if (a === null || b === null) return false;
	if (typeof a !== typeof b) return false;
	if (Array.isArray(a)) {
		if (!Array.isArray(b) || a.length !== b.length) return false;
		for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
		return true;
	}
	if (typeof a === "object" && typeof b === "object") {
		const ka = Object.keys(a as object).sort();
		const kb = Object.keys(b as object).sort();
		if (ka.length !== kb.length) return false;
		for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return false;
		for (const k of ka) {
			if (!deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) {
				return false;
			}
		}
		return true;
	}
	return false;
};

export const parseYaml = (text: string): unknown => YAML.parse(text);

// One per-file result entry. `Same` is included so JSON output can be
// stable across runs (a tool consumer may want the full list of files).
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

// Compute the diff between two filename→YAML-text maps. Both sides are
// parsed and redacted first, so the result reflects semantic deltas only.
export const diffFiles = (
	left: Readonly<Record<string, string>>,
	right: Readonly<Record<string, string>>,
): DiffResult => {
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
		const l = redact(parseYaml(left[file] ?? ""));
		const r = redact(parseYaml(right[file] ?? ""));
		entries.push(
			deepEqual(l, r) ? { _tag: "Same", file } : { _tag: "Changed", file, left: l, right: r },
		);
	}
	return { entries };
};

export const hasDifferences = (result: DiffResult): boolean =>
	result.entries.some((e) => e._tag !== "Same");

export type DiffFormat = "summary" | "detail" | "json";

// Render a diff result in one of the three FR-3.4 formats. The detail output
// is intentionally minimal — M4 will pipe through a richer diff renderer.
export const formatDiff = (result: DiffResult, format: DiffFormat = "summary"): string => {
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
