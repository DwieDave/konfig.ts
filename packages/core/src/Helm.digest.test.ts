import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { NodeServices } from "@effect/platform-node";
import { Cause, Effect, Exit } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as Helm from "./Helm";
import { RenderContext } from "./RenderContext";
import { HelmDigestMismatch } from "./RenderError";

const _sha256Hex = (buf: Buffer): string => crypto.createHash("sha256").update(buf).digest("hex");

interface Fixture {
	readonly cacheDir: string;
	readonly chart: string;
	readonly version: string;
	readonly tarball: Buffer;
	readonly digest: string;
	readonly cachedTgz: string;
}

const _setupFixture = async (): Promise<Fixture> => {
	const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), "konfig-helm-cache-test-"));
	const chart = "fixture";
	const version = "1.0.0";
	const tarball = Buffer.from("fake-helm-tarball-bytes\nDocument: kind: ConfigMap\nname: x");
	const digest = `sha256:${_sha256Hex(tarball)}`;
	const digestSuffix = digest.replace(/^sha256:/, "").slice(0, 12);
	const cachedTgz = path.join(cacheDir, `${chart}-${version}-${digestSuffix}.tgz`);
	await fs.writeFile(cachedTgz, tarball);
	return { cacheDir, chart, version, tarball, digest, cachedTgz };
};

describe("Helm.release digest verification", () => {
	let fixture: Fixture;

	beforeEach(async () => {
		fixture = await _setupFixture();
		process.env.KONFIG_HELM_CACHE = fixture.cacheDir;
	});

	afterEach(async () => {
		delete process.env.KONFIG_HELM_CACHE;
		await fs.rm(fixture.cacheDir, { recursive: true, force: true });
	});

	it("returns HelmDigestMismatch if a byte of the cached tarball is flipped", async () => {
		const tampered = Buffer.from(fixture.tarball);
		tampered[0] = (tampered[0] ?? 0) ^ 0xff;
		await fs.writeFile(fixture.cachedTgz, tampered);

		const m = Helm.release({
			repo: "https://example.com/charts",
			chart: fixture.chart,
			version: fixture.version,
			digest: fixture.digest,
			values: {},
		});

		const exit = await Effect.runPromiseExit(
			m.render(RenderContext.make("test")).pipe(Effect.provide(NodeServices.layer)),
		);
		expect(Exit.isFailure(exit)).toBe(true);
		if (Exit.isFailure(exit)) {
			const causeJson = Cause.pretty(exit.cause);
			expect(causeJson).toContain("HelmDigestMismatch");
			expect(causeJson).toContain(fixture.digest);
		}
	});

	it("HelmDigestMismatch class formats a useful message", () => {
		const err = new HelmDigestMismatch({
			chart: "x",
			version: "1.0.0",
			expected: "sha256:aaa",
			actual: "sha256:bbb",
		});
		expect(err._tag).toBe("HelmDigestMismatch");
		expect(err.message).toContain("expected sha256:aaa");
		expect(err.message).toContain("got sha256:bbb");
	});
});
