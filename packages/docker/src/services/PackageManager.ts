export interface ImageRef {
	readonly image: string;
	readonly tag: string;
}

export interface DepsImageInput {
	readonly runtimeImage: ImageRef;
	readonly pmVersion: string;
}

export type NodeModulesLayout = "isolated" | "hoisted";

export interface PackageManager {
	readonly _tag: "Bun" | "Npm" | "Pnpm";
	readonly lockfileNames: ReadonlyArray<string>;
	readonly auxFiles: ReadonlyArray<string>;
	readonly installCommand: ReadonlyArray<string>;
	/**
	 * Argv tokens to append to {@link installCommand} to skip
	 * `devDependencies`. Used by the `prod-deps` stage emitted when
	 * `RunnerSpec.production === true`.
	 *   bun  → ["--production"]
	 *   npm  → ["--omit=dev"]
	 *   pnpm → ["--prod"]
	 */
	readonly productionFlag: ReadonlyArray<string>;
	readonly nodeModulesLayout: NodeModulesLayout;
	readonly depsImage: (input: DepsImageInput) => ImageRef;
	/**
	 * RUN lines to prepend before {@link installCommand}. Currently only pnpm
	 * uses it to enable corepack with the requested version.
	 */
	readonly prependDepsRuns: (pmVersion: string) => ReadonlyArray<string>;
}
