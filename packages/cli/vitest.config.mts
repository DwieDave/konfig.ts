import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: {
			"@konfig.ts/argocd": fileURLToPath(new URL("../argocd/src/index.ts", import.meta.url)),
			"@konfig.ts/core": fileURLToPath(new URL("../core/src/index.ts", import.meta.url)),
			"@konfig.ts/docker": fileURLToPath(new URL("../docker/src/index.ts", import.meta.url)),
			"@konfig.ts/k8s": fileURLToPath(new URL("../k8s/src/index.ts", import.meta.url)),
		},
	},
	test: {
		exclude: ["dist/**", "node_modules/**"],
	},
});
