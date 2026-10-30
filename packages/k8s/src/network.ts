import { Manifest, type SecretRef } from "@konfig.ts/core"
import type {
  Ingress as K8sIngress,
  IngressBackend as K8sIngressBackend,
  IngressRule as K8sIngressRule,
  Service as K8sService,
  ServicePort as K8sServicePort
} from "./.generated/k8s-types"
import { _lowerServicePorts } from "./_lower"
import type { ContainerSpec } from "./container"
import { cloneList, copyMap, type NamespacedMetaInput, type StringMap, toObjectMeta } from "./meta"
import type { ServicePortSpec } from "./ports"

interface ServiceBase extends NamespacedMetaInput {
  readonly type?: "ClusterIP" | "NodePort" | "LoadBalancer"
  readonly clusterIP?: string
  readonly sessionAffinity?: string
  readonly publishNotReadyAddresses?: boolean
  readonly externalTrafficPolicy?: string
  readonly internalTrafficPolicy?: string
}

export interface ServiceInput extends ServiceBase {
  readonly selector: StringMap
  readonly ports: ReadonlyArray<K8sServicePort>
}

export interface ServiceFromContainerInput<Ports extends string> extends ServiceBase {
  readonly selector: StringMap
  readonly forContainer: ContainerSpec<Ports>
  readonly ports: ReadonlyArray<ServicePortSpec<NoInfer<Ports>>>
}

const _buildService = (input: ServiceInput): K8sService => ({
  apiVersion: "v1",
  kind: "Service",
  metadata: toObjectMeta(input),
  spec: {
    selector: copyMap(input.selector),
    type: input.type,
    ports: _lowerServicePorts(input.ports),
    clusterIP: input.clusterIP,
    sessionAffinity: input.sessionAffinity,
    publishNotReadyAddresses: input.publishNotReadyAddresses,
    externalTrafficPolicy: input.externalTrafficPolicy,
    internalTrafficPolicy: input.internalTrafficPolicy
  }
})

export const Service = {
  make: (input: ServiceInput): Manifest.Manifest<K8sService> => Manifest.make(() => _buildService(input)),
  fromContainer: <Ports extends string>(
    input: ServiceFromContainerInput<Ports>
  ): Manifest.Manifest<K8sService> => Service.make(input)
}

export interface IngressTLSInput {
  readonly hosts?: ReadonlyArray<string>
  readonly secretName: SecretRef<string>
}

export interface IngressInput extends NamespacedMetaInput {
  readonly ingressClassName?: string
  readonly rules?: ReadonlyArray<K8sIngressRule>
  readonly tls?: ReadonlyArray<IngressTLSInput>
  readonly defaultBackend?: K8sIngressBackend
}

const _buildIngress = (input: IngressInput): K8sIngress => ({
  apiVersion: "networking.k8s.io/v1",
  kind: "Ingress",
  metadata: toObjectMeta(input),
  spec: {
    ingressClassName: input.ingressClassName,
    rules: cloneList(input.rules),
    tls: input.tls?.map((t) => ({ hosts: cloneList(t.hosts), secretName: t.secretName })),
    defaultBackend: structuredClone(input.defaultBackend)
  }
})

export const Ingress = {
  make: (input: IngressInput): Manifest.Manifest<K8sIngress> => Manifest.make(() => _buildIngress(input))
}
