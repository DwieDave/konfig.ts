
export const SyncWave = (n: number): { "argocd.argoproj.io/sync-wave": string } => ({
	"argocd.argoproj.io/sync-wave": String(n),
});

export type HookPhase = "PreSync" | "Sync" | "PostSync" | "SyncFail" | "PostDelete";

export const Hook = (phase: HookPhase): { "argocd.argoproj.io/hook": string } => ({
	"argocd.argoproj.io/hook": phase,
});

export const SyncOptions = (
	opts: ReadonlyArray<string>,
): { "argocd.argoproj.io/sync-options": string } => ({
	"argocd.argoproj.io/sync-options": opts.join(","),
});
