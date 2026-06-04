import type { NodeModulesLayout, PackageManager } from "../PackageManager";

export interface PnpmOptions {
	readonly layout: NodeModulesLayout;
}

export const pnpm = (opts: PnpmOptions): PackageManager => ({
	_tag: "Pnpm",
	lockfileNames: ["pnpm-lock.yaml"],
	auxFiles: ["pnpm-workspace.yaml", ".npmrc"],
	installCommand: ["pnpm", "install", "--frozen-lockfile", "--ignore-scripts"],
	productionFlag: ["--prod"],
	nodeModulesLayout: opts.layout,
	depsImage: ({ runtimeImage }) => runtimeImage,
	prependDepsRuns: (version) => [`corepack enable pnpm && corepack prepare pnpm@${version} --activate`],
});
