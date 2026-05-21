import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: {
			"@konfig.ts/core": fileURLToPath(new URL("../core/src/index.ts", import.meta.url)),
			"@konfig.ts/env": fileURLToPath(new URL("../env/src/index.ts", import.meta.url)),
			"@konfig.ts/k8s": fileURLToPath(new URL("../k8s/src/index.ts", import.meta.url)),
			"@konfig.ts/sealed-secrets": fileURLToPath(
				new URL("../sealed-secrets/src/index.ts", import.meta.url),
			),
		},
	},
	test: {
		exclude: ["dist/**", "node_modules/**"],
	},
});
