import { brand } from "@konfig.ts/core"
import type { ConfigMapRef, PvcRef, SecretRef } from "@konfig.ts/core"

declare const VolumeNameBrand: unique symbol
export type VolumeName<N extends string> = string & {
  readonly [VolumeNameBrand]: N
}

const _volumeName = <const N extends string>(name: N): VolumeName<N> => brand<VolumeName<N>>(name)

export interface Volume<N extends string = string> {
  readonly name: VolumeName<N>
  readonly secret?: {
    readonly secretName: string
    readonly optional?: boolean
    readonly defaultMode?: number
  }
  readonly configMap?: {
    readonly name: string
    readonly optional?: boolean
    readonly defaultMode?: number
    readonly items?: ReadonlyArray<{ readonly key: string; readonly path: string }>
  }
  readonly emptyDir?: { readonly medium?: string; readonly sizeLimit?: string }
  readonly persistentVolumeClaim?: {
    readonly claimName: PvcRef<string>
    readonly readOnly?: boolean
  }
  readonly hostPath?: { readonly path: string; readonly type?: string }
}

export interface EmptyVolumeInput<N extends string> {
  readonly name: N
  readonly medium?: string
  readonly sizeLimit?: string
}

export interface VolumeFromSecretInput<N extends string> {
  readonly name: N
  readonly ref: SecretRef<string>
  readonly optional?: boolean
  readonly defaultMode?: number
}

export interface VolumeFromConfigMapInput<N extends string> {
  readonly name: N
  readonly ref: ConfigMapRef<string>
  readonly optional?: boolean
  readonly defaultMode?: number
  readonly items?: ReadonlyArray<{ readonly key: string; readonly path: string }>
}

export interface VolumeFromPvcInput<N extends string, PvcN extends string> {
  readonly name: N
  readonly claim: PvcRef<PvcN>
  readonly readOnly?: boolean
}

export const Volume = {
  empty: <const N extends string>(input: EmptyVolumeInput<N>): Volume<N> => ({
    name: _volumeName(input.name),
    emptyDir: { medium: input.medium, sizeLimit: input.sizeLimit }
  }),
  fromSecret: <const N extends string>(input: VolumeFromSecretInput<N>): Volume<N> => ({
    name: _volumeName(input.name),
    secret: {
      secretName: input.ref,
      optional: input.optional,
      defaultMode: input.defaultMode
    }
  }),
  fromConfigMap: <const N extends string>(input: VolumeFromConfigMapInput<N>): Volume<N> => ({
    name: _volumeName(input.name),
    configMap: {
      name: input.ref,
      optional: input.optional,
      defaultMode: input.defaultMode,
      items: input.items
    }
  }),
  fromPvc: <const N extends string, const PvcN extends string>(
    input: VolumeFromPvcInput<N, PvcN>
  ): Volume<N> => ({
    name: _volumeName(input.name),
    persistentVolumeClaim: { claimName: input.claim, readOnly: input.readOnly }
  }),
  mountRef: <const N extends string>(name: N): VolumeName<N> => _volumeName(name)
}

export interface VolumeMount<Mounts extends string = string> {
  readonly name: VolumeName<Mounts>
  readonly mountPath: string
  readonly readOnly?: boolean
  readonly subPath?: string
  readonly subPathExpr?: string
  readonly mountPropagation?: string
}

export type VolumeNamesOf<V extends ReadonlyArray<Volume<string>>> = {
  readonly [I in keyof V]: V[I] extends Volume<infer N> ? N : never
}[number]
