import { NodeServices } from "@effect/platform-node";
import { RenderContext, type ResolvedKonfigConfig } from "@konfig.ts/core";
import { Effect } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import { describe, expect, it } from "vitest";
import { renderEnv } from "./buildEnv";

const _writeEnvFile = (root: string, entry: string, body: string) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem;
		const path = yield* Path;
		const full = path.join(root, entry);
		yield* fs.makeDirectory(path.dirname(full), { recursive: true });
		yield* fs.writeFileString(full, body);
		return full;
	});

describe("renderEnv: BundleSetResult env", () => {
	it("writes per-bundle directories with no Application CR sentinel", async () => {
		const program = Effect.gen(function* () {
			const fs = yield* FileSystem;
			const path = yield* Path;
			const root = yield* fs.makeTempDirectoryScoped({ prefix: "konfig-bundle-" });

			const envBody = `
import { Bundle, ConfigMap } from "@konfig.ts/k8s";
const api = Bundle.define({
	name: "api",
	namespace: "app",
	build: () => [ConfigMap.make({ name: "api-conf", namespace: "app", data: { K: "v" } })],
});
export default Bundle.entrypoint(Bundle.fromModules({ modules: [api] as const }));
`;
			yield* _writeEnvFile(root, "infra/env/test.ts", envBody);

			const cfg: ResolvedKonfigConfig = {
				configDir: root,
				config: {
					root: "infra",
					cluster: "cluster.ts",
					modules: "modules",
					charts: "charts",
					outDir: { manifests: "rendered" },
					envs: {},
					crd: { outDir: ".generated/crd" },
					helm: { cacheDir: ".konfig/helm-cache", minVersion: "3.16.0" },
				},
			};
			const ctx = RenderContext.make("test");

			const rendered = yield* renderEnv({ cfg, envName: "test", ctx });
			const filePaths = rendered.files.map((f) => path.relative(rendered.outDirAbs, f.path));
			expect(filePaths.some((p) => p.startsWith("api/"))).toBe(true);
			expect(filePaths.some((p) => p.startsWith("Application-"))).toBe(false);
			return rendered;
		}).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

		await Effect.runPromise(program);
	});
});
