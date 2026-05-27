import type { PackageManager } from "../PackageManager";

export const bun: PackageManager = {
	_tag: "Bun",
	lockfileNames: ["bun.lock"],
	auxFiles: ["bunfig.toml"],
	installCommand: ["bun", "install", "--ignore-scripts"],
	nodeModulesLayout: "isolated",
	depsImage: ({ runtimeImage }) => runtimeImage,
	prependDepsRuns: () => [],
};
