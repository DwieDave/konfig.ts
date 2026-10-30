import type { SealedSecretSchema } from "./schema"

export type SealedSecretScope = "strict" | "namespace-wide" | "cluster-wide"

export type SealedSecret = typeof SealedSecretSchema.Type
