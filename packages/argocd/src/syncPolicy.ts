import { omitUndefined } from "@konfig.ts/core"
import type { SyncPolicy } from "./Application"

type Automated = NonNullable<SyncPolicy["automated"]>

type Retry = NonNullable<SyncPolicy["retry"]>

export interface MergeSyncPolicyInput {
  readonly def: SyncPolicy | undefined
  readonly app: SyncPolicy | undefined
}

const _mergeAutomated = (
  { def, app }: { readonly def: Automated | undefined; readonly app: Automated | undefined }
): Automated | undefined => {
  if (def === undefined) return app

  if (app === undefined) return def

  return app.enabled === false ? omitUndefined(app) : { ...def, ...omitUndefined(app) }
}

const _mergeRetry = (
  { def, app }: { readonly def: Retry | undefined; readonly app: Retry | undefined }
): Retry | undefined => {
  if (def === undefined) return app

  if (app === undefined) return def

  return {
    ...def,
    ...omitUndefined(app),
    backoff: def.backoff === undefined && app.backoff === undefined
      ? undefined
      : { ...def.backoff, ...omitUndefined({ ...app.backoff }) }
  }
}

export const mergeSyncPolicy = (input: MergeSyncPolicyInput): SyncPolicy | undefined => {
  const { def, app } = input

  if (def === undefined) return app

  if (app === undefined) return def

  return {
    automated: _mergeAutomated({ def: def.automated, app: app.automated }),
    syncOptions: app.syncOptions ?? def.syncOptions,
    retry: _mergeRetry({ def: def.retry, app: app.retry })
  }
}
