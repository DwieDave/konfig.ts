import { Config, Effect } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import { ChildProcess } from "effect/unstable/process";
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner";
import * as YAML from "yaml";
import { type Manifest, make, type RawYaml } from "./Manifest";
import { HelmRenderError } from "./RenderError";

// Cluster-scoped kinds — these don't carry a namespace, so the
// `--namespace` injection below skips them. Anything else inherits the
// chart's release namespace (nixidy parity behavior).
const CLUSTER_SCOPED_KINDS: ReadonlySet<string> = new Set([
	"APIService",
	"ClusterRole",
	"ClusterRoleBinding",
	"ComponentStatus",
	"CSIDriver",
	"CSINode",
	"CustomResourceDefinition",
	"FlowSchema",
	"IngressClass",
	"MutatingWebhookConfiguration",
	"Namespace",
	"Node",
	"PersistentVolume",
	"PodSecurityPolicy",
	"PriorityClass",
	"PriorityLevelConfiguration",
	"RuntimeClass",
	"StorageClass",
	"ValidatingAdmissionPolicy",
	"ValidatingAdmissionPolicyBinding",
	"ValidatingWebhookConfiguration",
	"VolumeAttachment",
]);

export interface HelmReleaseOptions {
	/** Helm repo URL, e.g. "https://cloudnative-pg.github.io/charts" or "oci://...". */
	readonly repo: string;
	/** Chart name within the repository. */
	readonly chart: string;
	/**
	 * Helm release name (becomes `.Release.Name` in chart templates).
	 * Defaults to `chart`. Charts that publish under a generic name
	 * (e.g. `cloudnative-pg`) but deploy under a more specific release
	 * name (`cloudnative-pg-operator`) set this explicitly.
	 */
	readonly releaseName?: string;
	/** Pinned semver version. */
	readonly version: string;
	/**
	 * sha256 digest of the chart tarball — used as the cache key suffix and
	 * (in a future iteration) for integrity verification of `helm pull` output.
	 * `"sha256:TODO"` is the accepted sentinel for charts whose digest hasn't
	 * been populated yet.
	 */
	readonly digest: string;
	/**
	 * Target namespace passed as `--namespace` to `helm template`. Becomes
	 * `.Release.Namespace` in chart templates and is therefore part of the
	 * rendered output (resource `metadata.namespace`, RoleBinding subject
	 * namespaces, etc.). Charts that don't set explicit namespaces fall back
	 * to this value, so it must match the workload's namespace for byte
	 * equivalence with nixidy's `applications.<x>.namespace`.
	 */
	readonly namespace?: string;
	/** Values passed to `helm template`. */
	readonly values: Record<string, unknown>;
	/**
	 * Extra CLI flags forwarded verbatim to `helm template`. Defaults to
	 * `[]` — nixidy doesn't pass `--no-hooks` (the rendered output for
	 * charts like cert-manager and argocd retains hook resources), so we
	 * match that for byte equivalence. Per-chart overrides can opt in to
	 * `--no-hooks` if a chart's hooks would otherwise drift.
	 */
	readonly extraOpts?: readonly string[];
}

// Parse `helm template` stdout (multi-doc YAML) into discrete RawYaml entries.
// Empty docs and pure-comment blocks are dropped. When `namespace` is set,
// every namespaced resource that doesn't already carry `metadata.namespace`
// gets it injected — matching nixidy's behavior. Cluster-scoped kinds
// (see `CLUSTER_SCOPED_KINDS`) are left untouched.
const parseHelmOutput = (
	output: string,
	chart: string,
	version: string,
	namespace: string | undefined,
): RawYaml[] => {
	const docs = output.split(/^---$/m);
	const results: RawYaml[] = [];
	for (const doc of docs) {
		const trimmed = doc.trim();
		if (trimmed.length === 0) continue;
		if (trimmed.startsWith("#") && !trimmed.includes("\n")) continue;

		let content = `---\n${trimmed}\n`;
		if (namespace !== undefined) {
			try {
				const parsed = YAML.parse(trimmed) as {
					kind?: string;
					metadata?: { namespace?: string };
				} | null;
				if (
					parsed !== null &&
					typeof parsed === "object" &&
					typeof parsed.kind === "string" &&
					!CLUSTER_SCOPED_KINDS.has(parsed.kind) &&
					(parsed.metadata?.namespace === undefined || parsed.metadata.namespace === "")
				) {
					const withNs = {
						...parsed,
						metadata: { ...(parsed.metadata ?? {}), namespace },
					};
					content = `---\n${YAML.stringify(withNs, { lineWidth: 0 })}`;
					if (!content.endsWith("\n")) content += "\n";
				}
			} catch {
				// Non-object docs (rare in helm output) — leave verbatim.
			}
		}

		results.push({
			_tag: "RawYaml",
			content,
			origin: `helm:${chart}@${version}`,
		});
	}
	return results;
};

// Ensure the chart tarball exists in the cache. Runs `helm pull` on cache miss
// and renames the helm-default filename (which is `<chart>-<version>.tgz`
// most of the time but some repos add a `v` prefix to the version — e.g.
// jetstack ships `cert-manager-v1.16.2.tgz`) to the digest-suffixed cache
// key so future invocations hit cache.
const ensureCachedTarball = (opts: HelmReleaseOptions, cacheDir: string, cachedTgz: string) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem;
		const spawner = yield* ChildProcessSpawner;
		const path = yield* Path;

		const cacheExists = yield* fs.exists(cachedTgz);
		if (cacheExists) return;

		// Snapshot pre-pull cache so we can detect the newly-pulled file
		// regardless of its filename quirks.
		const beforeFiles = new Set(
			yield* fs.readDirectory(cacheDir).pipe(Effect.orElseSucceed(() => [] as string[])),
		);

		const pull = ChildProcess.make("helm", [
			"pull",
			"--repo",
			opts.repo,
			opts.chart,
			"--version",
			opts.version,
			"--destination",
			cacheDir,
		]);
		yield* spawner.exitCode(pull);

		const afterFiles = yield* fs.readDirectory(cacheDir);
		const candidates = afterFiles.filter(
			(f) =>
				f.endsWith(".tgz") &&
				f.startsWith(opts.chart) &&
				!beforeFiles.has(f) &&
				path.join(cacheDir, f) !== cachedTgz,
		);
		if (candidates.length > 0) {
			yield* fs.rename(path.join(cacheDir, candidates[0] ?? ""), cachedTgz);
		}
	});

/**
 * T6.1 — `Helm.release(...)` primitive.
 *
 * Returns a `Manifest<RawYaml[]>`. At render time:
 *   1. Ensure the chart tarball is cached by digest (helm pull on miss).
 *   2. Write `values` to a scoped temp file.
 *   3. Run `helm template` and parse the multi-doc YAML output.
 *
 * Composition uses Effect's `FileSystem`, `Path`, and `ChildProcessSpawner`
 * services so the renderer is platform-neutral; the CLI (`@konfig.ts/cli`) provides
 * `BunServices.layer` at the runtime boundary. The scope from
 * `makeTempDirectoryScoped` is closed by `Effect.scoped` at the bottom of
 * this pipeline, so the caller never sees a `Scope` requirement leak out.
 */
export const release = (opts: HelmReleaseOptions): Manifest<RawYaml[]> => {
	const extraOpts = opts.extraOpts ?? [];

	return make<RawYaml[]>(() =>
		Effect.gen(function* () {
			const fs = yield* FileSystem;
			const path = yield* Path;
			const spawner = yield* ChildProcessSpawner;

			// Helm chart cache directory. The CLI sets `TSK_HELM_CACHE` from
			// `konfig.json helm.cacheDir`; otherwise fall back to a CWD-relative
			// default so tests/smokes can run without a konfig.json. Read via
			// Effect `Config` so the ambient `ConfigProvider` (env-backed by
			// default) is the single source of truth.
			const cacheDir = yield* Config.string("TSK_HELM_CACHE").pipe(
				Config.withDefault(path.join(process.cwd(), ".konfig", "helm-cache")),
			);
			yield* fs.makeDirectory(cacheDir, { recursive: true });

			const digestSuffix = opts.digest.replace(/^sha256:/, "").slice(0, 12);
			const cachedTgz = path.join(cacheDir, `${opts.chart}-${opts.version}-${digestSuffix}.tgz`);
			yield* ensureCachedTarball(opts, cacheDir, cachedTgz);

			// Scoped temp dir → auto-removed when this Effect's scope closes.
			const tmpDir = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-helm-" });
			const valuesFile = path.join(tmpDir, "values.yaml");
			yield* fs.writeFileString(valuesFile, YAML.stringify(opts.values, { lineWidth: 0 }));

			const releaseName = opts.releaseName ?? opts.chart;
			const template = ChildProcess.make("helm", [
				"template",
				releaseName,
				cachedTgz,
				"--values",
				valuesFile,
				...(opts.namespace !== undefined ? ["--namespace", opts.namespace] : []),
				...extraOpts,
			]);
			const stdout = yield* spawner.string(template);
			return parseHelmOutput(stdout, opts.chart, opts.version, opts.namespace);
		}).pipe(
			Effect.scoped,
			Effect.mapError(
				(cause) => new HelmRenderError({ chart: opts.chart, version: opts.version, cause }),
			),
		),
	);
};
