import { Application, Sync } from "@konfig.ts/argocd"
import { ConfigMap } from "@konfig.ts/k8s"

// `ConfigMap.make` infers a literal key union from `data`, so renaming a key here fails
// type-check at every `EnvVar.configMapEnv` / `EnvVar.fromConfigMap` call site.
export const featureFlags = ConfigMap.make({
  name: "feature-flags",
  namespace: "app",
  data: {
    NEW_UI: "true",
    BETA_DASHBOARD: "false",
    DARK_MODE: "true"
  }
})

export const defineFeatureFlags = Application.module({
  namespace: "app",
  annotations: Sync.wave(-1),
  build: (_ctx, _opts: Record<never, never>) => [featureFlags]
})
