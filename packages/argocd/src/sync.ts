export type HookPhase = "PreSync" | "Sync" | "PostSync" | "SyncFail" | "PostDelete"

// ArgoCD argocd.argoproj.io/* annotation helpers; spread the result into
// Application.define({ annotations }) or a resource's metadata.annotations.
export const Sync = {
  wave: (n: number): { "argocd.argoproj.io/sync-wave": string } => ({
    "argocd.argoproj.io/sync-wave": String(n)
  }),
  hook: (phase: HookPhase): { "argocd.argoproj.io/hook": string } => ({
    "argocd.argoproj.io/hook": phase
  }),
  options: (
    opts: ReadonlyArray<string>
  ): { "argocd.argoproj.io/sync-options": string } => ({
    "argocd.argoproj.io/sync-options": opts.join(",")
  })
}
