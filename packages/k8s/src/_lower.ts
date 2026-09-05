// Explicit, type-checked lowering from konfig's readonly/branded input shapes to the plain
// kubernetes-types shapes. Bodies copy arrays (fresh mutable arrays, so emitted manifests never
// alias caller-owned readonly arrays) and let branded strings widen to `string` structurally.
import { unsafeCoerce } from "@konfig.ts/core"
import type {
  Container as K8sContainer,
  PodSpec as K8sPodSpec,
  PodTemplateSpec as K8sPodTemplateSpec,
  ServicePort as K8sServicePort,
  Volume as K8sVolume
} from "./.generated/k8s-types"
import type { ContainerInput, PodSpecInput } from "./container"
import type { ProbeTarget } from "./ports"
import type { ServicePortSpec } from "./ports"
import type { Volume } from "./volume"

interface TemplateMetaInput {
  readonly labels?: Readonly<Record<string, string>>
  readonly annotations?: Readonly<Record<string, string>>
}

export interface PodTemplateInput {
  readonly metadata?: TemplateMetaInput
  readonly spec: PodSpecInput
}

type ProbeInput = K8sContainer["readinessProbe"] | ProbeTarget<string>

const _lowerProbe = (probe: ProbeInput): K8sContainer["readinessProbe"] => {
  if (probe === undefined) return undefined
  return {
    ...probe,
    httpGet: probe.httpGet === undefined ? undefined : {
      ...probe.httpGet,
      httpHeaders: probe.httpGet.httpHeaders === undefined
        ? undefined
        : [...probe.httpGet.httpHeaders]
    },
    tcpSocket: probe.tcpSocket === undefined ? undefined : { ...probe.tcpSocket },
    grpc: probe.grpc === undefined ? undefined : {
      port: probe.grpc.port,
      service: probe.grpc.service
    },
    exec: probe.exec === undefined ? undefined : {
      command: probe.exec.command === undefined ? undefined : [...probe.exec.command]
    }
  }
}

const _lowerVolume = (volume: Volume): K8sVolume => ({
  ...volume,
  configMap: volume.configMap === undefined ? undefined : {
    ...volume.configMap,
    items: volume.configMap.items === undefined ? undefined : [...volume.configMap.items]
  }
})

const _lowerContainer = (container: ContainerInput): K8sContainer => ({
  ...container,
  image: container.image,
  env: container.env === undefined ? undefined : [...container.env],
  ports: container.ports === undefined ? undefined : [...container.ports],
  readinessProbe: _lowerProbe(container.readinessProbe),
  livenessProbe: _lowerProbe(container.livenessProbe),
  startupProbe: _lowerProbe(container.startupProbe),
  volumeMounts: container.volumeMounts === undefined ? undefined : [...container.volumeMounts]
})

const _lowerPodSpec = (spec: PodSpecInput): K8sPodSpec => ({
  ...spec,
  containers: spec.containers.map(_lowerContainer),
  initContainers: spec.initContainers?.map(_lowerContainer),
  volumes: spec.volumes?.map(_lowerVolume),
  imagePullSecrets: spec.imagePullSecrets === undefined
    ? undefined
    : spec.imagePullSecrets.map((s) => ({ name: s.name })),
  serviceAccountName: spec.serviceAccountName
})

export const _lowerPodTemplate = (template: PodTemplateInput): K8sPodTemplateSpec => ({
  metadata: template.metadata === undefined ? undefined : {
    labels: template.metadata.labels === undefined ? undefined : { ...template.metadata.labels },
    annotations: template.metadata.annotations === undefined
      ? undefined
      : { ...template.metadata.annotations }
  },
  spec: _lowerPodSpec(template.spec)
})

export const _lowerServicePorts = (
  ports: ReadonlyArray<K8sServicePort | ServicePortSpec<string>>
): Array<K8sServicePort> => ports.map((p) => ({ ...p }))

// Typed key/value entries of an object with statically known keys. The single coercion narrows
// Object.entries' `[string, V][]` to O's own keys — sound for objects without excess properties,
// which `const`-inferred literal maps are.
export const _entriesOf = <O extends object>(
  obj: O
): ReadonlyArray<readonly [keyof O & string, O[keyof O]]> =>
  unsafeCoerce<ReadonlyArray<readonly [keyof O & string, O[keyof O]]>>(
    Object.entries(obj),
    "Object.entries yields the object's own enumerable string keys and their values"
  )
