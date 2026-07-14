export type HookPhase = "PreSync" | "Sync" | "PostSync" | "SyncFail" | "PostDelete"

/**
 * `Sync` value namespace — ArgoCD `argocd.argoproj.io/*` annotation
 * helpers. Each call returns a single-property annotation record ready
 * to spread into `Application.define({ annotations })` or any
 * resource's `metadata.annotations`.
 *
 *   annotations: { ...Sync.wave(-1), ...Sync.options(["Replace=true"]) }
 */
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
