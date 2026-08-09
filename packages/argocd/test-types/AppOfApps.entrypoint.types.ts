import { AppOfApps } from "@konfig.ts/argocd"
import type { Dep, Manifest } from "@konfig.ts/core"
import type { Effect } from "effect"

declare const goodProgram: Effect.Effect<
  { readonly _tag: "ok" },
  never,
  Manifest.RenderServices
>

declare const missingGhcrPull: Effect.Effect<
  { readonly _tag: "bad" },
  never,
  Dep.Need<"Secret", "ghcr-pull"> | Manifest.RenderServices
>

declare const missingMultiple: Effect.Effect<
  { readonly _tag: "worse" },
  never,
  Dep.Need<"Secret", "ghcr-pull"> | Dep.Need<"Namespace", "infra"> | Manifest.RenderServices
>

const _ok = AppOfApps.entrypoint(goodProgram)

// @ts-expect-error _konfig_unsatisfied (Secret "ghcr-pull")
const _missingOne = AppOfApps.entrypoint(missingGhcrPull)

// @ts-expect-error _konfig_unsatisfied (union of both Needs)
const _missingTwo = AppOfApps.entrypoint(missingMultiple)

void _ok
void _missingOne
void _missingTwo
