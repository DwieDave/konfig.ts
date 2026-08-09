import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		exclude: ["dist/**", "node_modules/**"],
		coverage: {
			provider: "v8",
			include: ["src/**/*.ts"],
			exclude: ["src/**/*.test.ts", "src/.generated/**"],
			reporter: ["text-summary", "json-summary"],
		},
	},
});
