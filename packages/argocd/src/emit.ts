import { Manifest, Yaml } from "@konfig.ts/core";
import { Effect } from "effect";
import type { Any as AnyApp } from "./Application";
import type { AppOfAppsDefaults, AppOfAppsTarget } from "./AppOfApps";

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

interface _MergeSyncPolicyInput {
	readonly def: AppOfAppsDefaults["syncPolicy"];
	readonly app: AnyApp["syncPolicy"];
}
const _mergeSyncPolicy = (input: _MergeSyncPolicyInput): AnyApp["syncPolicy"] => {
	const { def, app } = input;
	if (def === undefined) return app;
	if (app === undefined) return def;
	return {
		automated: app.automated ?? def.automated,
		syncOptions: app.syncOptions ?? def.syncOptions,
		retry: app.retry ?? def.retry,
	};
};

export interface BuildCRInput {
	readonly app: AnyApp;
	readonly target: AppOfAppsTarget;
	readonly defaults: AppOfAppsDefaults;
}
export const buildCR = (input: BuildCRInput): ApplicationCR => {
	const { app, target, defaults } = input;
	const server = defaults.destination?.server ?? "https://kubernetes.default.svc";
	const path = `${target.rootPath}/${app.name}`;
	const controllerNamespace = target.controllerNamespace ?? "argocd";
	const syncPolicy = _mergeSyncPolicy({ def: defaults.syncPolicy, app: app.syncPolicy });

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

export const emitApplicationCR = (input: BuildCRInput): Manifest.Manifest<string> => {
	const cr = buildCR(input);
	const yaml = Yaml.serialize({ value: cr });
	return Manifest.make<string>((_ctx) => Effect.succeed(yaml));
};

export const serializeApplicationCR = (input: BuildCRInput): string =>
	Yaml.serialize({ value: buildCR(input) });

export const applicationCRFilename = (app: AnyApp): string => `Application-${app.name}.yaml`;
