import type { BuiltImageRef, SecretRef, ServiceAccountRef } from "@konfig.ts/core"
import { unsafeCoerce } from "@konfig.ts/core"
import type { Container as K8sContainer, PodSpec as K8sPodSpec } from "./.generated/k8s-types"
import type { EnvVar } from "./env"
import type { ContainerPort, NamesOf, ProbeTarget } from "./ports"
import type { Volume, VolumeMount, VolumeNamesOf } from "./volume"

/**
 * Container input — extends the full K8s Container API. Konfig's
 * branded helpers (`EnvVar.value`, `EnvVar.fromSecret`,
 * `EnvVar.fromConfigMap`) produce `EnvVar` instances whose runtime
 * shape matches `K8sEnvVar`; the override
 * here narrows the field to readonly + the branded helper output so
 * `secretKeyRef.name` carries its `SecretRef<N>` brand at construction
 * time.
 *
 * `image` is overridden as required (K8s lets it be optional for
 * higher-level controllers that default it; konfig wants every
 * container to have an explicit image).
 *
 * `ports[i].name` accepts the branded `PortName<string>` from `Port.make(...)`
 * as well as a raw string; the typed builder `Container` is the
 * link that captures the literal name union for cross-reference checks.
 */
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
  /**
   * Container image. Accepts a raw string (escape hatch for vendor
   * images: `ghcr.io/bitnami/postgresql:16.0.0`) or a `BuiltImageRef<App>`
   * produced by `Dep.builtImageRef` / `Dep.provideImage`. The branded
   * path ties the workload into the dep graph — a workload referencing
   * an image whose build module isn't in the composition fails at
   * `AppOfApps.entrypoint`.
   */
  readonly image: string | BuiltImageRef<string>
  readonly env?: ReadonlyArray<EnvVar>
  readonly ports?: ReadonlyArray<
    ContainerPort | {
      readonly containerPort: number
      readonly name?: string
      readonly protocol?: "TCP" | "UDP" | "SCTP"
    }
  >
  /**
   * Probes accept either the upstream K8s shape or konfig's branded
   * `ProbeTarget<string>` (from `Container`). The two are
   * structurally close — the union lets a `ContainerSpec` flow
   * through `Workload.web`'s containers slot without a cast.
   */
  readonly readinessProbe?: K8sContainer["readinessProbe"] | ProbeTarget<string>
  readonly livenessProbe?: K8sContainer["livenessProbe"] | ProbeTarget<string>
  readonly startupProbe?: K8sContainer["startupProbe"] | ProbeTarget<string>
  /**
   * Volume mounts accept the upstream K8s shape or konfig's branded
   * `VolumeMount<string>` (from `Container` / `mountRef`). Same
   * rationale as the probe widening above.
   */
  readonly volumeMounts?:
    | K8sContainer["volumeMounts"]
    | ReadonlyArray<VolumeMount<string>>
}

/**
 * Strongly-typed container builder. Captures the union of named ports
 * declared via `port({ name, containerPort })` as a phantom type
 * parameter, then constrains every probe's `port` field to that union.
 *
 * Pair with `Service.fromContainer({ forContainer })` in `network.ts`
 * to link a Service's `targetPort` to the same union — a typo or
 * undeclared port name is a compile error.
 */
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

/**
 * Union of any literal env-var names that appear more than once in `Envs`.
 * Computes the intersection of pairwise names — if `Envs[I]` and `Envs[J]`
 * share a literal name (i ≠ j), that name leaks into the union. Empty
 * when every name is unique.
 */
type DuplicateEnvNames<Envs extends ReadonlyArray<EnvVar<string>>> = {
  [I in keyof Envs]: {
    [J in keyof Envs]: J extends I ? never
      : _EnvNameOf<Envs[I]> & _EnvNameOf<Envs[J]> extends never ? never
      : _EnvNameOf<Envs[I]> & _EnvNameOf<Envs[J]>
  }[number]
}[number]

/**
 * Empty (`unknown`) when `Envs` has no duplicate names; otherwise an
 * inline object type whose required `_konfig_duplicate_env_names`
 * property carries a template-literal hint sentence. Intersected with
 * the `env` slot, an unmet property surfaces the sentence inline in the
 * TS error — far more discoverable than a runtime "last-wins" surprise.
 */
type EnvDupCheck<Envs extends ReadonlyArray<EnvVar<string>>> = [DuplicateEnvNames<Envs>] extends [never] ? unknown
  : {
    readonly _konfig_duplicate_env_names: `Duplicate env name(s): "${DuplicateEnvNames<
      Envs
    >}". K8s silently last-wins; rename one of the colliding entries or remove the manual valueEnv that shadows another producer.`
  }

/**
 * `Container` value namespace.
 *
 *   const apiContainer = Container.define({
 *     name: "api",
 *     image: apiImage,
 *     ports: [Port.make({ name: "http", containerPort: 8080 })],
 *     readinessProbe: { httpGet: { port: Port.ref("http") } },
 *     env: [...],
 *   });
 *
 * `Container.define` captures the union of named ports (from
 * `Port.make`) as `Ports`, the union of mounted volume names (from
 * `Volume.mountRef`) as `Mounts`, and validates that the `env` list
 * has no duplicate env-var names. The first two phantoms travel on
 * `ContainerSpec`; `Pod.define` checks the container's Mounts against
 * the pod's declared volume names.
 *
 * Duplicate env names are caught at the call site via a template-literal
 * error message — see `EnvDupCheck`. With no volumeMounts and no env,
 * all phantoms collapse to `never` so the container slots into any pod.
 */
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

/**
 * `Pod.define` input. The pod declares a tuple of `Volume`s and lists
 * containers whose `Mounts` phantom is checked against the declared
 * volume names via `NoInfer`. A container referencing an undeclared
 * volume — or a typo — fails at the call site rather than at pod-startup
 * time with "container references volume not found."
 */
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

/**
 * Pod spec input — extends K8s PodSpec but tightens the fields where
 * konfig adds brand checking: `imagePullSecrets`, `serviceAccountName`,
 * and `volumes` (the helpers in `volume.ts` produce konfig `Volume`
 * objects that lower to K8s `Volume`).
 */
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

/**
 * `Pod` value namespace.
 *
 *   const pod = Pod.define({
 *     volumes: [Volume.empty({ name: "config" })],
 *     containers: [Container.define({ ..., volumeMounts: [...] })],
 *   });
 *
 *   imagePullSecrets: [Pod.imagePullSecret(ghcrRef)],
 *
 * - `Pod.define(input)` ties container `volumeMounts[i].name` to the
 *   pod's declared volume names via `NoInfer`.
 * - `Pod.imagePullSecret(ref)` returns the `{ name: SecretRef }` entry
 *   consumed by Deployment / StatefulSet / Job / CronJob workloads.
 */
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
