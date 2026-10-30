// No workspace package.json lives here, so this config avoids importing
// "vitest/config" — that import can't resolve without a local node_modules.
export default {
	resolve: {
		alias: { "@konfig.ts/core": new URL("src/index.ts", new URL("../packages/core/", import.meta.url)).pathname },
	},
	test: {
		include: ["**/*.test.ts"],
		exclude: ["node_modules/**"],
	},
};
