import type { AppOfAppsResult } from "@konfig.ts/argocd"
import type { Bundle } from "@konfig.ts/core"
import { Schema } from "effect"

const _SyncPolicySchema = Schema.Struct({
  automated: Schema.optional(
    Schema.Struct({
      prune: Schema.optional(Schema.Boolean),
      selfHeal: Schema.optional(Schema.Boolean),
      allowEmpty: Schema.optional(Schema.Boolean)
    })
  ),
  syncOptions: Schema.optional(Schema.Array(Schema.String)),
  retry: Schema.optional(
    Schema.Struct({
      limit: Schema.optional(Schema.Finite),
      backoff: Schema.optional(
        Schema.Struct({
          duration: Schema.optional(Schema.String),
          factor: Schema.optional(Schema.Finite),
          maxDuration: Schema.optional(Schema.String)
        })
      )
    })
  )
})

const _ApplicationSchema = Schema.Struct({
  name: Schema.String,
  namespace: Schema.String,
  manifests: Schema.Array(Schema.Unknown),
  source: Schema.Struct({
    repoURL: Schema.String,
    targetRevision: Schema.String,
    path: Schema.String
  }),
  project: Schema.optional(Schema.String),
  syncPolicy: Schema.optional(_SyncPolicySchema),
  annotations: Schema.optional(Schema.Record(Schema.String, Schema.String))
})

const _AppOfAppsResultSchema = Schema.Struct({
  name: Schema.String,
  target: Schema.Struct({
    repoURL: Schema.String,
    branch: Schema.String,
    rootPath: Schema.String,
    controllerNamespace: Schema.optional(Schema.String)
  }),
  defaults: Schema.Struct({
    destination: Schema.optional(Schema.Struct({ server: Schema.optional(Schema.String) })),
    project: Schema.optional(Schema.String),
    syncPolicy: Schema.optional(_SyncPolicySchema)
  }),
  apps: Schema.Array(_ApplicationSchema)
})

const _BundleSetResultSchema = Schema.Struct({
  name: Schema.String,
  bundles: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      namespace: Schema.optional(Schema.String),
      manifests: Schema.Array(Schema.Unknown)
    })
  )
})

export type EnvResult = AppOfAppsResult | Bundle.BundleSetResult

const EnvResultSchema = Schema.Union([_AppOfAppsResultSchema, _BundleSetResultSchema])

export const decodeEnvResult = Schema.decodeUnknownEffect(EnvResultSchema)
