import semver from "semver";
import { describe, expect, it } from "vitest";
import { _parseHelmVersion } from "./helmVersion";

describe("_parseHelmVersion", () => {
	it("parses a plain release version", () => {
		expect(_parseHelmVersion("v3.16.0")).toBe("3.16.0");
		expect(_parseHelmVersion("v3.16.0+g1234abc\n")).toBe("3.16.0+g1234abc");
	});

	it("preserves pre-release suffix (no truncation)", () => {
		expect(_parseHelmVersion("v3.16.0-rc.1")).toBe("3.16.0-rc.1");
		expect(_parseHelmVersion("v3.17.0-beta.2+g0000\n")).toBe("3.17.0-beta.2+g0000");
	});

	it("returns null for unparseable input", () => {
		expect(_parseHelmVersion("")).toBe(null);
		expect(_parseHelmVersion("helm: not found")).toBe(null);
	});

	it("semver.gte with includePrerelease admits a pre-release that meets minVersion", () => {
		expect(semver.gte("3.16.0-rc.1", "3.15.0", { includePrerelease: true })).toBe(true);
		expect(semver.gte("3.16.0-rc.1", "3.16.0", { includePrerelease: true })).toBe(false);
	});
});
