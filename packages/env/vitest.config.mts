import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: {
			"@konfig.ts/core": fileURLToPath(new URL("../core/src/index.ts", import.meta.url)),
		},
	},
	test: {
		exclude: ["dist/**", "node_modules/**"],
		coverage: {
			provider: "v8",
			include: ["src/**/*.ts"],
			exclude: ["src/**/*.test.ts", "src/.generated/**"],
			reporter: ["text-summary", "json-summary"],
			thresholds: { lines: 96 },
		},
	},
});
