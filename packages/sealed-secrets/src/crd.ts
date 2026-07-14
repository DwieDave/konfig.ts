export type SealedSecretScope = "strict" | "namespace-wide" | "cluster-wide"

export interface SealedSecretTemplate {
  readonly metadata?: {
    readonly name?: string
    readonly namespace?: string
    readonly labels?: Readonly<Record<string, string>>
    readonly annotations?: Readonly<Record<string, string>>
  }
  readonly type?: string
  readonly immutable?: boolean
}

export interface SealedSecretSpec {
  readonly template?: SealedSecretTemplate
  readonly encryptedData: Readonly<Record<string, string>>
}

export interface SealedSecret {
  readonly apiVersion: "bitnami.com/v1alpha1"
  readonly kind: "SealedSecret"
  readonly metadata: {
    readonly name: string
    readonly namespace: string
    readonly labels?: Readonly<Record<string, string>>
    readonly annotations?: Readonly<Record<string, string>>
  }
  readonly spec: SealedSecretSpec
}
