import type {
  ClusterRoleBindingInput,
  ClusterRoleInput,
  CronJobInput,
  DefinePodSetInput,
  EmptyVolumeInput,
  IngressInput,
  IngressTLSInput,
  JobInput,
  K8s,
  NetworkPolicyInput,
  PersistentVolumeClaimInput,
  PersistentVolumeInput,
  RawEnvInput,
  RoleBindingInput,
  RoleInput,
  ServiceAccountInput,
  ServiceAccountManifest,
  StatefulSetInput,
  VolumeFromConfigMapInput,
  VolumeFromSecretInput
} from "@konfig.ts/k8s"
import { ConfigMapRef, Pod, SecretRef, ServiceAccount, ServiceAccountRef, Workload } from "@konfig.ts/k8s"

type Expect<T extends true> = T

type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false

type Has<T, K extends PropertyKey> = K extends keyof T ? true : false

type _K8sDeployment = Expect<Equal<K8s.Deployment["kind"], "Deployment" | undefined>>

type _K8sServiceAccount = Expect<Equal<K8s.ServiceAccount["kind"], "ServiceAccount" | undefined>>

type _K8sRbac = Expect<Equal<K8s.ClusterRoleBinding["kind"], "ClusterRoleBinding" | undefined>>

type _Sts = Expect<Has<StatefulSetInput, "name" | "namespace" | "selector" | "template" | "serviceName">>

type _Job = Expect<Has<JobInput, "name" | "namespace" | "template" | "backoffLimit">>

type _Cron = Expect<Has<CronJobInput, "name" | "namespace" | "schedule" | "jobTemplate">>

type _Pv = Expect<Has<PersistentVolumeInput, "name" | "spec">>

type _PvNoNamespace = Expect<Equal<Has<PersistentVolumeInput, "namespace">, false>>

type _Pvc = Expect<Has<PersistentVolumeClaimInput, "name" | "namespace" | "spec">>

type _Role = Expect<Has<RoleInput, "name" | "namespace" | "rules">>

type _RoleBinding = Expect<Has<RoleBindingInput, "name" | "namespace" | "roleRef" | "subjects">>

type _ClusterRole = Expect<Has<ClusterRoleInput, "name" | "rules" | "aggregationRule">>

type _ClusterRoleBinding = Expect<Has<ClusterRoleBindingInput, "name" | "roleRef" | "subjects">>

type _NetPol = Expect<Has<NetworkPolicyInput, "name" | "namespace" | "spec">>

type _Ingress = Expect<Has<IngressInput, "name" | "namespace" | "rules" | "tls" | "defaultBackend">>

type _IngressTls = Expect<Has<IngressTLSInput, "secretName" | "hosts">>

type _PodSet = Expect<Has<DefinePodSetInput<{ app: "api" }>, "podSet" | "deployment" | "service" | "netPol">>

type _Empty = Expect<Has<EmptyVolumeInput<"v">, "name" | "medium" | "sizeLimit">>

type _FromSecret = Expect<Equal<VolumeFromSecretInput<"v">["ref"], SecretRef<string>>>

type _FromConfigMap = Expect<Equal<VolumeFromConfigMapInput<"v">["ref"], ConfigMapRef<string>>>

type _Raw = Expect<Has<RawEnvInput<"X">, "name" | "value" | "valueFrom">>

type _SaInput = Expect<Has<ServiceAccountInput<"api">, "name" | "namespace" | "imagePullSecrets">>

const sa = ServiceAccount.make({ name: "api", namespace: "prod" })

type _SaManifest = Expect<Equal<typeof sa, ServiceAccountManifest<"api">>>

type _SaRef = Expect<Equal<typeof sa.ref, ServiceAccountRef<"api">>>

// @ts-expect-error - a raw string is not a ServiceAccountRef.
const _rawSaRef: ServiceAccountRef<"api"> = "api"

// @ts-expect-error - ServiceAccountRef<"worker"> is not ServiceAccountRef<"api">.
const _wrongSaRef: ServiceAccountRef<"api"> = ServiceAccountRef.of("worker")

const _pull = Pod.imagePullSecret(SecretRef.of("ghcr-pull"))

const _cron = Workload.cron({
  name: "nightly",
  namespace: "prod",
  schedule: "0 0 * * *",
  containers: [{ name: "job", image: "runner" }],
  imagePullSecrets: [_pull]
})

const _rawPull = Workload.cron({
  name: "nightly",
  namespace: "prod",
  schedule: "0 0 * * *",
  containers: [{ name: "job", image: "runner" }],
  // @ts-expect-error - a raw string is not a SecretRef.
  imagePullSecrets: [{ name: "ghcr-pull" }]
})

void _rawSaRef

void _wrongSaRef

void _cron

void _rawPull

export type _Tests = readonly [
  _K8sDeployment,
  _K8sServiceAccount,
  _K8sRbac,
  _Sts,
  _Job,
  _Cron,
  _Pv,
  _PvNoNamespace,
  _Pvc,
  _Role,
  _RoleBinding,
  _ClusterRole,
  _ClusterRoleBinding,
  _NetPol,
  _Ingress,
  _IngressTls,
  _PodSet,
  _Empty,
  _FromSecret,
  _FromConfigMap,
  _Raw,
  _SaInput,
  _SaManifest,
  _SaRef
]
