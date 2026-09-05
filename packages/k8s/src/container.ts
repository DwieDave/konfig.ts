import type { BuiltImageRef, SecretRef, ServiceAccountRef } from "@konfig.ts/core"
import type { Container as K8sContainer, PodSpec as K8sPodSpec } from "./.generated/k8s-types"
import type { EnvVar } from "./env"
import type { ContainerPort, ProbeTarget } from "./ports"
import type { Volume, VolumeMount } from "./volume"

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

// P and M are the port/mount name unions, inferred directly from the `ports` and
// `volumeMounts` elements. Probe targets are NoInfer<P> so a typo'd probe port
// reference errors instead of widening the inferred union.
export interface DefineContainerInput<
  P extends string,
  M extends string,
  Envs extends ReadonlyArray<EnvVar<string>>
> extends
  Omit<
    ContainerInput,
    "ports" | "readinessProbe" | "livenessProbe" | "startupProbe" | "volumeMounts" | "env"
  >
{
  readonly name: string
  readonly image: string
  readonly ports: ReadonlyArray<ContainerPort<P>>
  readonly readinessProbe?: ProbeTarget<NoInfer<P>>
  readonly livenessProbe?: ProbeTarget<NoInfer<P>>
  readonly startupProbe?: ProbeTarget<NoInfer<P>>
  readonly volumeMounts?: ReadonlyArray<VolumeMount<M>>
  readonly env?: Envs & EnvDupCheck<Envs>
}

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
    const P extends string,
    const M extends string = never,
    const Envs extends ReadonlyArray<EnvVar<string>> = readonly []
  >(
    input: DefineContainerInput<P, M, Envs>
  ): ContainerSpec<P, M> => ({
    ...input,
    env: input.env
  })
}

export interface DefinePodInput<N extends string> {
  readonly volumes: ReadonlyArray<Volume<N>>
  readonly containers: ReadonlyArray<ContainerSpec<string, NoInfer<N>>>
  readonly initContainers?: ReadonlyArray<ContainerSpec<string, NoInfer<N>>>
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
  define: <const N extends string>(
    input: DefinePodInput<N>
  ): DefinedPod<N> => ({
    volumes: input.volumes,
    containers: input.containers,
    initContainers: input.initContainers
  }),
  imagePullSecret: (ref: SecretRef<string>): { readonly name: SecretRef<string> } => ({
    name: ref
  })
}
