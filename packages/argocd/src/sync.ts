import { Result, Schema } from "effect"

type HookPhase = "PreSync" | "Sync" | "PostSync" | "SyncFail" | "PostDelete"

const _decodeWave = (n: number): number => Result.getOrThrow(Schema.decodeResult(Schema.Int)(n))

const _syncOptionsKey = "argocd.argoproj.io/sync-options"

// ArgoCD argocd.argoproj.io/* annotation helpers; spread the result into
// Application.define({ annotations }) or a resource's metadata.annotations.
export const Sync = {
  wave: (n: number) => ({
    "argocd.argoproj.io/sync-wave": String(_decodeWave(n))
  }),
  hook: (phase: HookPhase) => ({
    "argocd.argoproj.io/hook": phase
  }),
  options: (opts: ReadonlyArray<string>): Readonly<Record<string, string>> =>
    opts.length === 0 ? {} : { [_syncOptionsKey]: opts.join(",") }
}
