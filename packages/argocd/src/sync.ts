export type HookPhase = "PreSync" | "Sync" | "PostSync" | "SyncFail" | "PostDelete"

type IntegerLiteral<N extends number> = `${N}` extends `${string}.${string}` | `${string}e${string}` ? never : N

const _syncOptionsKey = "argocd.argoproj.io/sync-options"

// ArgoCD argocd.argoproj.io/* annotation helpers; spread the result into
// Application.define({ annotations }) or a resource's metadata.annotations.
export const Sync = {
  wave: <const N extends number>(n: IntegerLiteral<N>) => ({
    "argocd.argoproj.io/sync-wave": String(n)
  }),
  hook: (phase: HookPhase) => ({
    "argocd.argoproj.io/hook": phase
  }),
  options: (opts: ReadonlyArray<string>): Readonly<Record<string, string>> =>
    opts.length === 0 ? {} : { [_syncOptionsKey]: opts.join(",") }
}
