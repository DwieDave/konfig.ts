import { AppOfAppsResult } from "@konfig.ts/argocd"
import { Bundle } from "@konfig.ts/core"
import { Schema } from "effect"

const EnvResultSchema = Schema.Union([AppOfAppsResult, Bundle.BundleSetResult])

export type EnvResult = typeof EnvResultSchema.Type

export const decodeEnvResult = Schema.decodeUnknownEffect(EnvResultSchema)
