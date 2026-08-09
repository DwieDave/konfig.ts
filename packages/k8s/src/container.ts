import type { BuiltImageRef, SecretRef, ServiceAccountRef } from "@konfig.ts/core"
import { unsafeCoerce } from "@konfig.ts/core"
import type { Container as K8sContainer, PodSpec as K8sPodSpec } from "./.generated/k8s-types"
import type { EnvVar } from "./env"
import type { ContainerPort, NamesOf, ProbeTarget } from "./ports"
import type { Volume, VolumeMount, VolumeNamesOf } from "./volume"

export interface ContainerInput extends
  Omit<
    K8sContainer,
    | "env"
    | "image"
    | "ports"
    | "readinessProbe"
    | "livenessProbe"
    | "startupProbe"
    | "volumeMounts"
  >
{
  readonly image: string | BuiltImageRef<string>
  readonly env?: ReadonlyArray<EnvVar>
  readonly ports?: ReadonlyArray<
    ContainerPort | {
      readonly containerPort: number
      readonly name?: string
      readonly protocol?: "TCP" | "UDP" | "SCTP"
    }
  >
  readonly readinessProbe?: K8sContainer["readinessProbe"] | ProbeTarget<string>
  readonly livenessProbe?: K8sContainer["livenessProbe"] | ProbeTarget<string>
  readonly startupProbe?: K8sContainer["startupProbe"] | ProbeTarget<string>
  readonly volumeMounts?:
    | K8sContainer["volumeMounts"]
    | ReadonlyArray<VolumeMount<string>>
}

export interface ContainerSpec<Ports extends string = string, Mounts extends string = string> extends
  Omit<
    ContainerInput,
    "ports" | "readinessProbe" | "livenessProbe" | "startupProbe" | "volumeMounts"
  >
{
  readonly name: string
  readonly image: string
  readonly ports: ReadonlyArray<ContainerPort<Ports>>
  readonly readinessProbe?: ProbeTarget<Ports>
  readonly livenessProbe?: ProbeTarget<Ports>
  readonly startupProbe?: ProbeTarget<Ports>
  readonly volumeMounts?: ReadonlyArray<VolumeMount<Mounts>>
  readonly __portNames?: Ports
  readonly __mountNames?: Mounts
}

export interface DefineContainerInput<
  Ports extends ReadonlyArray<ContainerPort<string>>,
  Mounts extends ReadonlyArray<VolumeMount<string>>,
  Envs extends ReadonlyArray<EnvVar<string>>
> extends
  Omit<
    ContainerInput,
    "ports" | "readinessProbe" | "livenessProbe" | "startupProbe" | "volumeMounts" | "env"
  >
{
  readonly name: string
  readonly image: string
  readonly ports: Ports
  readonly readinessProbe?: ProbeTarget<NamesOf<Ports>>
  readonly livenessProbe?: ProbeTarget<NamesOf<Ports>>
  readonly startupProbe?: ProbeTarget<NamesOf<Ports>>
  readonly volumeMounts?: Mounts
  readonly env?: Envs & EnvDupCheck<Envs>
}

type MountNamesOf<M extends ReadonlyArray<VolumeMount<string>>> = {
  readonly [I in keyof M]: M[I] extends VolumeMount<infer N> ? N : never
}[number]

type _EnvNameOf<X> = X extends EnvVar<infer N> ? N : never

type DuplicateEnvNames<Envs extends ReadonlyArray<EnvVar<string>>> = {
  [I in keyof Envs]: {
    [J in keyof Envs]: J extends I ? never
      : _EnvNameOf<Envs[I]> & _EnvNameOf<Envs[J]> extends never ? never
      : _EnvNameOf<Envs[I]> & _EnvNameOf<Envs[J]>
  }[number]
}[number]

type EnvDupCheck<Envs extends ReadonlyArray<EnvVar<string>>> = [DuplicateEnvNames<Envs>] extends [never] ? unknown
  : {
    readonly _konfig_duplicate_env_names: `Duplicate env name(s): "${DuplicateEnvNames<
      Envs
    >}". K8s silently last-wins; rename one of the colliding entries or remove the manual valueEnv that shadows another producer.`
  }

export const Container = {
  define: <
    const Ports extends ReadonlyArray<ContainerPort<string>>,
    const Mounts extends ReadonlyArray<VolumeMount<string>> = readonly [],
    const Envs extends ReadonlyArray<EnvVar<string>> = readonly []
  >(
    input: DefineContainerInput<Ports, Mounts, Envs>
  ): ContainerSpec<NamesOf<Ports>, MountNamesOf<Mounts>> => {
    type P = NamesOf<Ports>
    type M = MountNamesOf<Mounts>
    const out: ContainerSpec<P, M> = {
      ...input,
      ports: unsafeCoerce<ReadonlyArray<ContainerPort<P>>>(
        input.ports,
        "Ports tuple's element brands are the same PortName<N>; widening Ports → readonly ContainerPort<P>[] only changes the static shape, not the runtime values"
      ),
      readinessProbe: input.readinessProbe,
      livenessProbe: input.livenessProbe,
      startupProbe: input.startupProbe,
      volumeMounts: unsafeCoerce<ReadonlyArray<VolumeMount<M>> | undefined>(
        input.volumeMounts,
        "Mounts tuple's element brands are the same VolumeMount<N>; widening Mounts → readonly VolumeMount<M>[] preserves runtime shape"
      ),
      env: unsafeCoerce<ReadonlyArray<EnvVar<string>> | undefined>(
        input.env,
        "EnvDupCheck<Envs> intersection vanishes at runtime; the runtime value is the original EnvVar[]"
      )
    }
    return out
  }
}

export interface DefinePodInput<V extends ReadonlyArray<Volume<string>>> {
  readonly volumes: V
  readonly containers: ReadonlyArray<ContainerSpec<string, NoInfer<VolumeNamesOf<V>>>>
  readonly initContainers?: ReadonlyArray<ContainerSpec<string, NoInfer<VolumeNamesOf<V>>>>
}

export interface DefinedPod<MountNames extends string> {
  readonly volumes: ReadonlyArray<Volume<MountNames>>
  readonly containers: ReadonlyArray<ContainerSpec<string, MountNames>>
  readonly initContainers?: ReadonlyArray<ContainerSpec<string, MountNames>>
}

export interface PodSpecInput extends
  Omit<
    K8sPodSpec,
    | "containers"
    | "initContainers"
    | "volumes"
    | "imagePullSecrets"
    | "serviceAccountName"
  >
{
  readonly containers: ReadonlyArray<ContainerInput>
  readonly initContainers?: ReadonlyArray<ContainerInput>
  readonly volumes?: ReadonlyArray<Volume>
  readonly imagePullSecrets?: ReadonlyArray<{ readonly name: SecretRef<string> }>
  readonly serviceAccountName?: ServiceAccountRef<string> | string
}

export const Pod = {
  define: <const V extends ReadonlyArray<Volume<string>>>(
    input: DefinePodInput<V>
  ): DefinedPod<VolumeNamesOf<V>> => ({
    volumes: unsafeCoerce<ReadonlyArray<Volume<VolumeNamesOf<V>>>>(
      input.volumes,
      "V tuple's elements are Volume<N>; widening V → readonly Volume<VolumeNamesOf<V>>[] is a structural relaxation, runtime value unchanged"
    ),
    containers: input.containers,
    initContainers: input.initContainers
  }),
  imagePullSecret: (ref: SecretRef<string>): { readonly name: SecretRef<string> } => ({
    name: ref
  })
}
