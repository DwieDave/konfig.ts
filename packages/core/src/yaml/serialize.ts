import * as YAML from "yaml";

const ORDER_ROOT = ["apiVersion", "kind", "metadata", "spec", "status"];
const ORDER_METADATA = ["name", "namespace", "labels", "annotations"];

// Reorder an object's keys per FR-2.1 / FR-2.2 / FR-2.4.
// `depth` is 0 at the document root. `parentKey` is the map key under which
// the current object sits (used only to detect top-level `metadata`). The
// nixidy-rendered manifests treat nested `metadata` (e.g. `spec.template.metadata`)
// as plain alphabetical, so the custom metadata order applies at depth === 1.
const reorderObject = (
	obj: Record<string, unknown>,
	depth: number,
	parentKey: string | null,
): Record<string, unknown> => {
	// Drop keys whose value is `null` or `undefined`. Helm chart templates
	// often emit `field: {{ .Values.x | toYaml }}` which renders as
	// `field: null` when the value is unset; nixidy strips these for diff
	// parity. K8s treats `null` and "key absent" identically in spec, so
	// stripping is semantically safe.
	const keys = Object.keys(obj).filter((k) => obj[k] !== null && obj[k] !== undefined);
	const order =
		depth === 0 ? ORDER_ROOT : depth === 1 && parentKey === "metadata" ? ORDER_METADATA : null;

	let sortedKeys: string[];
	if (order !== null) {
		const known = order.filter((k) => keys.includes(k));
		const rest = keys.filter((k) => !order.includes(k)).sort();
		sortedKeys = [...known, ...rest];
	} else {
		sortedKeys = keys.slice().sort();
	}

	const out: Record<string, unknown> = {};
	for (const k of sortedKeys) {
		out[k] = normalize(obj[k], depth + 1, k);
	}
	return out;
};

const normalize = (value: unknown, depth: number, parentKey: string | null): unknown => {
	if (value === null || value === undefined) return value;
	if (Array.isArray(value)) {
		// Lists preserve user order (FR-2.3). Elements may be objects;
		// `parentKey` is irrelevant for list children (none of them sit under
		// a named map key).
		return value.map((v) => normalize(v, depth + 1, null));
	}
	if (typeof value === "object") {
		return reorderObject(value as Record<string, unknown>, depth, parentKey);
	}
	return value;
};

export interface SerializeOptions {
	// Default true. Set false to skip the trailing newline (e.g. for tests).
	readonly trailingNewline?: boolean;
}

// Serialize one Kubernetes resource (or any JSON-like value) to a stable
// string. Output uses LF endings, 2-space indent, no wrapped lines, and
// follows FR-2's key-order rules.
export const serialize = (value: unknown, opts?: SerializeOptions): string => {
	const normalized = normalize(value, 0, null);
	const raw = YAML.stringify(normalized, {
		indent: 2,
		indentSeq: true,
		lineWidth: 0,
		minContentWidth: 0,
		defaultStringType: "PLAIN",
		defaultKeyType: "PLAIN",
		// Force quoting on values that would otherwise re-parse as a different
		// type (e.g. "true", "1.0"). Without this the YAML lib emits them as
		// booleans/numbers, breaking round-trip equality (FR-2.7).
		nullStr: "null",
	});
	// Normalize line endings + ensure exactly one trailing newline.
	const lf = raw.replace(/\r\n/g, "\n").replace(/\s+$/g, "");
	return (opts?.trailingNewline ?? true) ? `${lf}\n` : lf;
};

// Filename rule per FR-2.5. Throws if the resource is missing kind or
// metadata.name — that's a programmer error, not a runtime input.
export const filenameFor = (resource: {
	readonly kind?: unknown;
	readonly metadata?: { readonly name?: unknown };
}): string => {
	const kind = resource.kind;
	const name = resource.metadata?.name;
	if (typeof kind !== "string" || kind.length === 0) {
		throw new Error(`filenameFor: resource has no string kind`);
	}
	if (typeof name !== "string" || name.length === 0) {
		throw new Error(`filenameFor: resource '${kind}' has no metadata.name`);
	}
	return `${kind}-${sanitizeNameForFilename(name)}.yaml`;
};

// Some Kubernetes resource names contain dots (CRDs use `<plural>.<group>`)
// or slashes that don't play well in filenames. Replace each with `-` to
// match nixidy's filename convention so per-file diffs line up by path.
const sanitizeNameForFilename = (name: string): string => name.replace(/[./]/g, "-");
