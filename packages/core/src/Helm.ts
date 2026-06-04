import * as crypto from "node:crypto";
import { Config, Effect } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import { ChildProcess, ChildProcessSpawner } from "./_unstable";
import * as YAML from "yaml";
import { coerce } from "./_cast";
import { type Manifest, make, type RawYaml } from "./Manifest";
import { HelmDigestMismatch, HelmRenderError } from "./RenderError";

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
	readonly repo: string;
	readonly chart: string;
	readonly releaseName?: string;
	readonly version: string;
	readonly digest: string;
	readonly namespace?: string;
	readonly values: Record<string, unknown>;
	readonly extraOpts?: readonly string[];
}

interface _ParseHelmOutputInput {
	readonly output: string;
	readonly chart: string;
	readonly version: string;
	readonly namespace: string | undefined;
}
const _parseHelmOutput = (input: _ParseHelmOutputInput): RawYaml[] => {
	const { output, chart, version, namespace } = input;
	const docs = output.split(/^---$/m);
	const results: RawYaml[] = [];
	for (const doc of docs) {
		const trimmed = doc.trim();
		if (trimmed.length === 0) continue;
		if (trimmed.startsWith("#") && !trimmed.includes("\n")) continue;

		let content = `---\n${trimmed}\n`;
		if (namespace !== undefined) {
			try {
				const parsed = coerce<{
					kind?: string;
					metadata?: { namespace?: string };
				} | null>(YAML.parse(trimmed));
				if (
					parsed !== null &&
					typeof parsed === "object" &&
					typeof parsed.kind === "string" &&
					!CLUSTER_SCOPED_KINDS.has(parsed.kind) &&
					(parsed.metadata?.namespace === undefined || parsed.metadata.namespace === "")
				) {
					const withNs = {
						...parsed,
						metadata: { ...parsed.metadata, namespace },
					};
					content = `---\n${YAML.stringify(withNs, { lineWidth: 0 })}`;
					if (!content.endsWith("\n")) content += "\n";
				}
			} catch {}
		}

		results.push({
			_tag: "RawYaml",
			content,
			origin: `helm:${chart}@${version}`,
		});
	}
	return results;
};

const _normalizeDigest = (digest: string): string =>
	digest.startsWith("sha256:") ? digest : `sha256:${digest}`;

const _hashFile = (filePath: string) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem;
		const bytes = yield* fs.readFile(filePath);
		const hash = crypto.createHash("sha256").update(bytes).digest("hex");
		return `sha256:${hash}`;
	});

interface _VerifyDigestInput {
	readonly opts: HelmReleaseOptions;
	readonly cachedTgz: string;
}

const _verifyDigest = (input: _VerifyDigestInput) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem;
		const expected = _normalizeDigest(input.opts.digest);
		const actual = yield* _hashFile(input.cachedTgz);
		if (expected !== actual) {
			yield* fs.remove(input.cachedTgz).pipe(Effect.ignore);
			return yield* Effect.fail(
				new HelmDigestMismatch({
					chart: input.opts.chart,
					version: input.opts.version,
					expected,
					actual,
				}),
			);
		}
	});

interface _EnsureCachedTarballInput {
	readonly opts: HelmReleaseOptions;
	readonly cacheDir: string;
	readonly cachedTgz: string;
}
const _ensureCachedTarball = (input: _EnsureCachedTarballInput) =>
	Effect.gen(function* () {
		const { opts, cacheDir, cachedTgz } = input;
		const fs = yield* FileSystem;
		const spawner = yield* ChildProcessSpawner;
		const path = yield* Path;

		const cacheExists = yield* fs.exists(cachedTgz);
		if (cacheExists) {
			yield* _verifyDigest({ opts, cachedTgz });
			return;
		}

		const beforeFiles = new Set(
			yield* fs.readDirectory(cacheDir).pipe(Effect.orElseSucceed((): string[] => [])),
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
		yield* _verifyDigest({ opts, cachedTgz });
	});

export const release = (opts: HelmReleaseOptions): Manifest<RawYaml[]> => {
	const extraOpts = opts.extraOpts ?? [];

	return make<RawYaml[]>(() =>
		Effect.gen(function* () {
			const fs = yield* FileSystem;
			const path = yield* Path;
			const spawner = yield* ChildProcessSpawner;

			const cacheDir = yield* Config.string("TSK_HELM_CACHE").pipe(
				Config.withDefault(path.join(process.cwd(), ".konfig", "helm-cache")),
			);
			yield* fs.makeDirectory(cacheDir, { recursive: true });

			const digestSuffix = opts.digest.replace(/^sha256:/, "").slice(0, 12);
			const cachedTgz = path.join(cacheDir, `${opts.chart}-${opts.version}-${digestSuffix}.tgz`);
			yield* _ensureCachedTarball({ opts, cacheDir, cachedTgz });

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
			return _parseHelmOutput({
				output: stdout,
				chart: opts.chart,
				version: opts.version,
				namespace: opts.namespace,
			});
		}).pipe(
			Effect.scoped,
			Effect.mapError(
				(cause) => new HelmRenderError({ chart: opts.chart, version: opts.version, cause }),
			),
		),
	);
};
