// Explicit, type-checked lowering from konfig's readonly/branded input shapes to the plain
// kubernetes-types shapes. Bodies deep-copy their input (so emitted manifests never alias
// caller-owned objects or arrays) and let branded strings widen to `string` structurally.
import type {
  Container as K8sContainer,
  PodSpec as K8sPodSpec,
  PodTemplateSpec as K8sPodTemplateSpec,
  ServicePort as K8sServicePort,
  Volume as K8sVolume
} from "./.generated/k8s-types"
import type { ContainerInput, PodSpecInput } from "./container"
import { type PodTemplateMetaInput, toLabelsMeta } from "./meta"
import type { ProbeTarget } from "./ports"
import type { ServicePortSpec } from "./ports"
import type { Volume } from "./volume"

export interface PodTemplateInput {
  readonly metadata?: PodTemplateMetaInput
  readonly spec: PodSpecInput
}

type ProbeInput = K8sContainer["readinessProbe"] | ProbeTarget<string>

const _lowerProbe = (probe: ProbeInput): K8sContainer["readinessProbe"] => {
  if (probe === undefined) return undefined

  return {
    ...structuredClone(probe),
    httpGet: probe.httpGet === undefined ? undefined : {
      ...probe.httpGet,
      httpHeaders: probe.httpGet.httpHeaders === undefined
        ? undefined
        : structuredClone([...probe.httpGet.httpHeaders])
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
  ...structuredClone(volume),
  configMap: volume.configMap === undefined ? undefined : {
    ...volume.configMap,
    items: volume.configMap.items === undefined
      ? undefined
      : structuredClone([...volume.configMap.items])
  }
})

const _lowerContainer = (container: ContainerInput): K8sContainer => ({
  ...structuredClone(container),
  image: container.image,
  command: container.command === undefined ? undefined : [...container.command],
  args: container.args === undefined ? undefined : [...container.args],
  env: container.env === undefined ? undefined : container.env.map((e) => structuredClone(e)),
  ports: container.ports === undefined ? undefined : container.ports.map((p) => ({ ...p })),
  readinessProbe: _lowerProbe(container.readinessProbe),
  livenessProbe: _lowerProbe(container.livenessProbe),
  startupProbe: _lowerProbe(container.startupProbe),
  volumeMounts: container.volumeMounts === undefined
    ? undefined
    : container.volumeMounts.map((m) => ({ ...m }))
})

const _lowerPodSpec = (spec: PodSpecInput): K8sPodSpec => ({
  ...structuredClone(spec),
  containers: spec.containers.map(_lowerContainer),
  initContainers: spec.initContainers?.map(_lowerContainer),
  volumes: spec.volumes?.map(_lowerVolume),
  imagePullSecrets: spec.imagePullSecrets === undefined
    ? undefined
    : spec.imagePullSecrets.map((s) => ({ name: s.name })),
  serviceAccountName: spec.serviceAccountName
})

export const _lowerPodTemplate = (template: PodTemplateInput): K8sPodTemplateSpec => ({
  metadata: toLabelsMeta(template.metadata),
  spec: _lowerPodSpec(template.spec)
})

export const _lowerServicePorts = (
  ports: ReadonlyArray<K8sServicePort | ServicePortSpec<string>>
): Array<K8sServicePort> => ports.map((p) => ({ ...p }))
