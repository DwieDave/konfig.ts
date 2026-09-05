import { Manifest, type SecretRef } from "@konfig.ts/core"
import { Effect } from "effect"
import { _lowerServicePorts } from "./_lower"
import type { IngressBackend as K8sIngressBackend } from "kubernetes-types/networking/v1"
import type {
  Ingress as K8sIngress,
  IngressRule as K8sIngressRule,
  IngressTLS as K8sIngressTLS,
  Service as K8sService,
  ServicePort as K8sServicePort
} from "./.generated/k8s-types"
import type { ContainerSpec } from "./container"
import type { ServicePortSpec } from "./ports"
import type { Selector } from "./selector"

export interface ServiceInput {
  readonly name: string
  readonly namespace: string
  readonly labels?: Readonly<Record<string, string>>
  readonly annotations?: Readonly<Record<string, string>>
  readonly selector: Readonly<Record<string, string>>
  readonly ports: ReadonlyArray<K8sServicePort>
  readonly type?: "ClusterIP" | "NodePort" | "LoadBalancer"
  readonly clusterIP?: string
  readonly sessionAffinity?: string
  readonly publishNotReadyAddresses?: boolean
  readonly externalTrafficPolicy?: string
  readonly internalTrafficPolicy?: string
}

export interface ServiceFromContainerInput<Ports extends string> {
  readonly name: string
  readonly namespace: string
  readonly labels?: Readonly<Record<string, string>>
  readonly annotations?: Readonly<Record<string, string>>
  readonly selector: Readonly<Record<string, string>>
  readonly forContainer: ContainerSpec<Ports>
  readonly ports: ReadonlyArray<ServicePortSpec<NoInfer<Ports>>>
  readonly type?: "ClusterIP" | "NodePort" | "LoadBalancer"
  readonly clusterIP?: string
  readonly sessionAffinity?: string
  readonly publishNotReadyAddresses?: boolean
  readonly externalTrafficPolicy?: string
  readonly internalTrafficPolicy?: string
}

export interface ServiceFromPodSetInput<L extends Readonly<Record<string, string>>> {
  readonly name: string
  readonly namespace: string
  readonly labels?: Readonly<Record<string, string>>
  readonly annotations?: Readonly<Record<string, string>>
  readonly podSet: Selector<L>
  readonly ports: ReadonlyArray<K8sServicePort>
  readonly type?: "ClusterIP" | "NodePort" | "LoadBalancer"
  readonly clusterIP?: string
  readonly sessionAffinity?: string
  readonly publishNotReadyAddresses?: boolean
  readonly externalTrafficPolicy?: string
  readonly internalTrafficPolicy?: string
}

export const Service = {
  make: (input: ServiceInput): Manifest.Manifest<K8sService> => {
    const resource: K8sService = {
      apiVersion: "v1",
      kind: "Service",
      metadata: {
        name: input.name,
        namespace: input.namespace,
        labels: input.labels,
        annotations: input.annotations
      },
      spec: {
        selector: input.selector,
        type: input.type,
        ports: _lowerServicePorts(input.ports),
        clusterIP: input.clusterIP,
        sessionAffinity: input.sessionAffinity,
        publishNotReadyAddresses: input.publishNotReadyAddresses,
        externalTrafficPolicy: input.externalTrafficPolicy,
        internalTrafficPolicy: input.internalTrafficPolicy
      }
    }
    return Manifest.make<K8sService>(() => Effect.succeed(resource))
  },
  fromContainer: <Ports extends string>(
    input: ServiceFromContainerInput<Ports>
  ): Manifest.Manifest<K8sService> =>
    Service.make({
      name: input.name,
      namespace: input.namespace,
      labels: input.labels,
      annotations: input.annotations,
      selector: input.selector,
      ports: _lowerServicePorts(input.ports),
      type: input.type,
      clusterIP: input.clusterIP,
      sessionAffinity: input.sessionAffinity,
      publishNotReadyAddresses: input.publishNotReadyAddresses,
      externalTrafficPolicy: input.externalTrafficPolicy,
      internalTrafficPolicy: input.internalTrafficPolicy
    }),
  fromPodSet: <L extends Readonly<Record<string, string>>>(
    input: ServiceFromPodSetInput<L>
  ): Manifest.Manifest<K8sService> =>
    Service.make({
      name: input.name,
      namespace: input.namespace,
      labels: input.labels,
      annotations: input.annotations,
      selector: input.podSet.labels,
      ports: input.ports,
      type: input.type,
      clusterIP: input.clusterIP,
      sessionAffinity: input.sessionAffinity,
      publishNotReadyAddresses: input.publishNotReadyAddresses,
      externalTrafficPolicy: input.externalTrafficPolicy,
      internalTrafficPolicy: input.internalTrafficPolicy
    })
}

export interface IngressTLSInput {
  readonly hosts?: ReadonlyArray<string>
  readonly secretName: SecretRef<string>
}

export interface IngressInput {
  readonly name: string
  readonly namespace: string
  readonly labels?: Readonly<Record<string, string>>
  readonly annotations?: Readonly<Record<string, string>>
  readonly ingressClassName?: string
  readonly rules?: ReadonlyArray<K8sIngressRule>
  readonly tls?: ReadonlyArray<IngressTLSInput>
  readonly defaultBackend?: K8sIngressBackend
}

export const Ingress = {
  make: (input: IngressInput): Manifest.Manifest<K8sIngress> => {
    const resource: K8sIngress = {
      apiVersion: "networking.k8s.io/v1",
      kind: "Ingress",
      metadata: {
        name: input.name,
        namespace: input.namespace,
        labels: input.labels,
        annotations: input.annotations
      },
      spec: {
        ingressClassName: input.ingressClassName,
        rules: input.rules === undefined ? undefined : [...input.rules],
        tls: input.tls?.map((t): K8sIngressTLS => ({
          hosts: t.hosts === undefined ? undefined : [...t.hosts],
          secretName: t.secretName
        })),
        defaultBackend: input.defaultBackend
      }
    }
    return Manifest.make<K8sIngress>(() => Effect.succeed(resource))
  },
  tls: (input: {
    readonly secretName: SecretRef<string>
    readonly hosts?: ReadonlyArray<string>
  }): IngressTLSInput => ({ secretName: input.secretName, hosts: input.hosts })
}
