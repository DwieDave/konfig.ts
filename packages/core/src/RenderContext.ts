/**
 * Context object threaded through every `Manifest.render(...)` call.
 *
 * `env` is the single load-bearing field: it keys both the file-output
 * directory under `outDir.manifests` and the choice of bundle entry in
 * `KonfigConfig.envs`. The optional fields below carry per-cluster
 * context for renders where one logical env spans multiple clusters.
 *
 * **Precedence rules:**
 *  - The output directory is keyed on `env` alone when `cluster` is
 *    `undefined`; when set, builds write to `<outDir>/<env>/<cluster>/`.
 *    Tests that bypass the CLI write into the simpler `<outDir>/<env>/`
 *    path by construction.
 *  - `cluster` is informational inside `Manifest.make((ctx) => ...)` —
 *    no constructor mutates a manifest based on it implicitly; the
 *    caller branches.
 *  - `k8sVersion` is a hint for renderers that emit
 *    apiVersion-conditional resources (e.g. `policy/v1beta1` vs
 *    `policy/v1`).
 *  - `flags` is the escape hatch for one-off "render with X" toggles
 *    that don't deserve their own field. Use sparingly.
 */
export interface RenderContext {
	readonly env: string;
	readonly cluster?: string;
	readonly k8sVersion?: string;
	readonly flags?: ReadonlyMap<string, unknown>;
}

export interface RenderContextFullInput {
	readonly env: string;
	readonly cluster?: string;
	readonly k8sVersion?: string;
	readonly flags?: ReadonlyMap<string, unknown>;
}

export const RenderContext = {
	make: (env: string): RenderContext => ({ env }),
	makeFull: (input: RenderContextFullInput): RenderContext => ({
		env: input.env,
		...(input.cluster !== undefined ? { cluster: input.cluster } : {}),
		...(input.k8sVersion !== undefined ? { k8sVersion: input.k8sVersion } : {}),
		...(input.flags !== undefined ? { flags: input.flags } : {}),
	}),
};
