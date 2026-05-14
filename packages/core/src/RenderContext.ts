// Context threaded through every Manifest.render call. Carries cluster-wide
// info that modules may need at render time (currently just the env name).
// M3/M4 will extend this with the ArgoCD target and the resolved konfig.json.
export interface RenderContext {
	readonly env: string;
}

export const RenderContext = {
	make: (env: string): RenderContext => ({ env }),
};
