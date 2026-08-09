// No workspace package.json lives here, so this config avoids importing
// "vitest/config" — that import can't resolve without a local node_modules.
export default {
	test: {
		include: ["**/*.test.ts"],
		exclude: ["node_modules/**"],
	},
};
