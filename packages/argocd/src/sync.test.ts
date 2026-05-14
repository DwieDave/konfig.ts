import { describe, expect, it } from "vitest";
import { Hook, SyncOptions, SyncWave } from "./sync";

describe("SyncWave", () => {
	it("returns the wave annotation with a string value", () => {
		expect(SyncWave(-1)).toEqual({ "argocd.argoproj.io/sync-wave": "-1" });
		expect(SyncWave(0)).toEqual({ "argocd.argoproj.io/sync-wave": "0" });
		expect(SyncWave(1)).toEqual({ "argocd.argoproj.io/sync-wave": "1" });
		expect(SyncWave(5)).toEqual({ "argocd.argoproj.io/sync-wave": "5" });
	});
});

describe("Hook", () => {
	it("returns the hook annotation for all valid phases", () => {
		expect(Hook("PreSync")).toEqual({ "argocd.argoproj.io/hook": "PreSync" });
		expect(Hook("Sync")).toEqual({ "argocd.argoproj.io/hook": "Sync" });
		expect(Hook("PostSync")).toEqual({ "argocd.argoproj.io/hook": "PostSync" });
		expect(Hook("SyncFail")).toEqual({ "argocd.argoproj.io/hook": "SyncFail" });
		expect(Hook("PostDelete")).toEqual({ "argocd.argoproj.io/hook": "PostDelete" });
	});
});

describe("SyncOptions", () => {
	it("joins options with a comma", () => {
		expect(SyncOptions(["CreateNamespace=true"])).toEqual({
			"argocd.argoproj.io/sync-options": "CreateNamespace=true",
		});
		expect(SyncOptions(["CreateNamespace=true", "Replace=true"])).toEqual({
			"argocd.argoproj.io/sync-options": "CreateNamespace=true,Replace=true",
		});
	});

	it("returns empty string for empty opts", () => {
		expect(SyncOptions([])).toEqual({ "argocd.argoproj.io/sync-options": "" });
	});
});
