import { describe, expect, it } from "vitest";
import { Sync } from "./sync";

describe("Sync.wave", () => {
	it("returns the wave annotation with a string value", () => {
		expect(Sync.wave(-1)).toEqual({ "argocd.argoproj.io/sync-wave": "-1" });
		expect(Sync.wave(0)).toEqual({ "argocd.argoproj.io/sync-wave": "0" });
		expect(Sync.wave(1)).toEqual({ "argocd.argoproj.io/sync-wave": "1" });
		expect(Sync.wave(5)).toEqual({ "argocd.argoproj.io/sync-wave": "5" });
	});
});

describe("Sync.hook", () => {
	it("returns the hook annotation for all valid phases", () => {
		expect(Sync.hook("PreSync")).toEqual({ "argocd.argoproj.io/hook": "PreSync" });
		expect(Sync.hook("Sync")).toEqual({ "argocd.argoproj.io/hook": "Sync" });
		expect(Sync.hook("PostSync")).toEqual({ "argocd.argoproj.io/hook": "PostSync" });
		expect(Sync.hook("SyncFail")).toEqual({ "argocd.argoproj.io/hook": "SyncFail" });
		expect(Sync.hook("PostDelete")).toEqual({ "argocd.argoproj.io/hook": "PostDelete" });
	});
});

describe("Sync.options", () => {
	it("joins options with a comma", () => {
		expect(Sync.options(["CreateNamespace=true"])).toEqual({
			"argocd.argoproj.io/sync-options": "CreateNamespace=true",
		});
		expect(Sync.options(["CreateNamespace=true", "Replace=true"])).toEqual({
			"argocd.argoproj.io/sync-options": "CreateNamespace=true,Replace=true",
		});
	});

	it("returns empty string for empty opts", () => {
		expect(Sync.options([])).toEqual({ "argocd.argoproj.io/sync-options": "" });
	});
});
