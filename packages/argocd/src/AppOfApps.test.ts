import { describe, expect, it } from "vitest";
import { Application, AppOfApps, SyncWave } from "./index";

const target: AppOfApps.AppOfAppsTarget = {
	repoURL: "ssh://git@github.com/example/infra.git",
	branch: "main",
	rootPath: "./infra/k8s/manifests/prod",
};

const defaults: AppOfApps.AppOfAppsDefaults = {
	destination: { server: "https://kubernetes.default.svc" },
};

const _appSource = (name: string): Application.ArgoSource => ({
	repoURL: target.repoURL,
	targetRevision: target.branch,
	path: `${target.rootPath}/${name}`,
});

describe("Application.make", () => {
	it("builds an Application with the given name/namespace", () => {
		const app = Application.make({
			name: "sops-secrets-operator",
			namespace: "argocd",
			manifests: [],
			source: _appSource("sops-secrets-operator"),
			syncPolicy: { automated: { prune: false, selfHeal: false } },
			annotations: SyncWave(-1),
		});

		expect(app.name).toBe("sops-secrets-operator");
		expect(app.namespace).toBe("argocd");
		expect(app.annotations).toEqual({ "argocd.argoproj.io/sync-wave": "-1" });
		expect(app.syncPolicy).toEqual({ automated: { prune: false, selfHeal: false } });
	});

	it("omits annotations/syncPolicy when not provided", () => {
		const app = Application.make({
			name: "minimal",
			namespace: "default",
			manifests: [],
			source: _appSource("minimal"),
		});

		expect(app.annotations).toBeUndefined();
		expect(app.syncPolicy).toBeUndefined();
	});
});

describe("AppOfApps.make", () => {
	it("builds an AppOfApps with the given apps", () => {
		const certManager = Application.make({
			name: "cert-manager",
			namespace: "cert-manager",
			manifests: [],
			source: _appSource("cert-manager"),
		});

		const web = Application.make({
			name: "web",
			namespace: "web",
			manifests: [],
			source: _appSource("web"),
		});

		const aoa = AppOfApps.make({ target, defaults, apps: [certManager, web] });
		expect(aoa.apps).toHaveLength(2);
		expect(aoa.target.branch).toBe("main");
		expect(aoa.defaults.destination?.server).toBe("https://kubernetes.default.svc");
	});
});
