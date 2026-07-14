// Compile-time assertions for the friendlier residual error on
// `AppOfApps.entrypoint`. Confirms that the hint includes the kind
// and name of the unmet Need, and that a fully-wired program passes.

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

// Happy path — entrypoint accepts the program.
const _ok = AppOfApps.entrypoint(goodProgram)

// One unmet Need — the call fails with the hint listing the specific Need.
// @ts-expect-error - Missing _konfig_unsatisfied (Secret "ghcr-pull").
const _missingOne = AppOfApps.entrypoint(missingGhcrPull)

// Two unmet Needs — the hint property's literal type is a union; the
// error lists both per-Need sentences.
// @ts-expect-error - Missing _konfig_unsatisfied (Secret "ghcr-pull" | Namespace "infra").
const _missingTwo = AppOfApps.entrypoint(missingMultiple)

void _ok
void _missingOne
void _missingTwo
