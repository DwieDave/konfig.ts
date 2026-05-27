import type { PackageManager } from "../PackageManager";

export const npm: PackageManager = {
	_tag: "Npm",
	lockfileNames: ["package-lock.json"],
	auxFiles: [".npmrc"],
	installCommand: ["npm", "ci", "--ignore-scripts"],
	nodeModulesLayout: "isolated",
	depsImage: ({ runtimeImage }) => runtimeImage,
	prependDepsRuns: () => [],
};
