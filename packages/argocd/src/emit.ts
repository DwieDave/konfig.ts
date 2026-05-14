import { Manifest, Yaml } from "@konfig.ts/core";
import { Effect } from "effect";
import type { Any as AnyApp } from "./Application";
import type { AppOfAppsDefaults, AppOfAppsTarget } from "./AppOfApps";

// The shape of a rendered ArgoCD Application CR.
// Matches the nixidy-rendered output exactly (see Application-sops-secrets-operator.yaml).
interface ApplicationCR {
	readonly apiVersion: "argoproj.io/v1alpha1";
	readonly kind: "Application";
	readonly metadata: {
		readonly annotations?: Readonly<Record<string, string>>;
		readonly name: string;
		readonly namespace: string;
	};
	readonly spec: {
		readonly destination: {
			readonly namespace: string;
			readonly server: string;
		};
		readonly project: string;
		readonly source: {
			readonly path: string;
			readonly repoURL: string;
			readonly targetRevision: string;
		};
		readonly syncPolicy?: unknown;
	};
}

// Merge a per-app syncPolicy on top of the AppOfApps defaults. Each
// field is overridden at the top level (no deep merge of `automated`)
// — matching nixidy's behavior where per-app overrides replace the
// corresponding default group atomically.
const mergeSyncPolicy = (
	def: AppOfAppsDefaults["syncPolicy"],
	app: AnyApp["syncPolicy"],
): AnyApp["syncPolicy"] => {
	if (def === undefined) return app;
	if (app === undefined) return def;
	return {
		automated: app.automated ?? def.automated,
		syncOptions: app.syncOptions ?? def.syncOptions,
		retry: app.retry ?? def.retry,
	};
};

// Build the CR object from an Application + target/defaults.
// `app.namespace` is the WORKLOAD namespace (where the rendered manifests
// run). The CR itself lives in `target.controllerNamespace` (default
// "argocd" — where the ArgoCD controller watches for `Application` CRs).
export const buildCR = (
	app: AnyApp,
	target: AppOfAppsTarget,
	defaults: AppOfAppsDefaults,
): ApplicationCR => {
	const server = defaults.destination?.server ?? "https://kubernetes.default.svc";
	const path = `${target.rootPath}/${app.name}`;
	const controllerNamespace = target.controllerNamespace ?? "argocd";
	const syncPolicy = mergeSyncPolicy(defaults.syncPolicy, app.syncPolicy);

	const hasAnnotations = app.annotations !== undefined && Object.keys(app.annotations).length > 0;

	const metadata: ApplicationCR["metadata"] = {
		...(hasAnnotations ? { annotations: app.annotations } : {}),
		name: app.name,
		namespace: controllerNamespace,
	};

	return {
		apiVersion: "argoproj.io/v1alpha1",
		kind: "Application",
		metadata,
		spec: {
			destination: {
				namespace: app.namespace,
				server,
			},
			project: "default",
			source: {
				path,
				repoURL: target.repoURL,
				targetRevision: target.branch,
			},
			...(syncPolicy !== undefined ? { syncPolicy } : {}),
		},
	};
};

// Emit one Application CR as a Manifest. M9 dropped the per-Manifest
// `P = Single<"Application", Name>` tracking — the Application is
// announced via `Layer.succeed(Dep.Application(name))(name)` in the
// surrounding module instead.
export const emitApplicationCR = (
	app: AnyApp,
	target: AppOfAppsTarget,
	defaults: AppOfAppsDefaults,
): Manifest.Manifest<string> => {
	const cr = buildCR(app, target, defaults);
	const yaml = Yaml.serialize(cr);
	return Manifest.make<string>((_ctx) => Effect.succeed(yaml));
};

// Serialize one Application CR to a YAML string directly (no Manifest wrapper).
// The M4 writer uses this to produce `apps/Application-<name>.yaml`.
export const serializeApplicationCR = (
	app: AnyApp,
	target: AppOfAppsTarget,
	defaults: AppOfAppsDefaults,
): string => Yaml.serialize(buildCR(app, target, defaults));

// Standard filename for an Application CR output file.
export const applicationCRFilename = (app: AnyApp): string =>
	`Application-${app.name}.yaml`;
