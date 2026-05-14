// Sync helpers — emit ArgoCD-specific annotation maps that callers spread into
// the Application's `annotations` field.

// Return the sync-wave annotation. Value is always a quoted integer string,
// matching nixidy's output (e.g. "-1", "1").
export const SyncWave = (n: number): { "argocd.argoproj.io/sync-wave": string } => ({
	"argocd.argoproj.io/sync-wave": String(n),
});

export type HookPhase = "PreSync" | "Sync" | "PostSync" | "SyncFail" | "PostDelete";

// Return the ArgoCD hook annotation.
export const Hook = (phase: HookPhase): { "argocd.argoproj.io/hook": string } => ({
	"argocd.argoproj.io/hook": phase,
});

// Return the syncOptions annotation, joining the opts array with commas.
export const SyncOptions = (
	opts: ReadonlyArray<string>,
): { "argocd.argoproj.io/sync-options": string } => ({
	"argocd.argoproj.io/sync-options": opts.join(","),
});
