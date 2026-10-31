import type {
  PvcRefName as CorePvcRefName,
  SecretRefName as CoreSecretRefName,
  ServiceAccountRef as CoreServiceAccountRef
} from "@konfig.ts/core"
import type { LiteralEntry, SecretEntry } from "@konfig.ts/env"
import type {
  BackendEmitInput,
  BackendTag,
  BindEnvironmentInput,
  BindSecretInput,
  ConfigMapEnvInput,
  ConfigMapInput,
  ConfigMapManifest,
  ConfigMapRefName,
  ContainerInput,
  ContainerPort,
  ContainerProtocol,
  ContainerSpec,
  DeclaredDownward,
  DeclaredEnvironment,
  DeclaredLiteral,
  DeclaredMember,
  DeclaredSecret,
  DefineContainerInput,
  DefinedPod,
  DefinePodInput,
  DeploymentFromPodSetInput,
  DeploymentInput,
  EnvVarSource,
  ExecAction,
  GrpcAction,
  HashSecretValuesInput,
  HasSecrets,
  HttpGetAction,
  HttpHeader,
  NamesOf,
  NamespaceInput,
  NamespaceManifest,
  NativeSecretOptions,
  NetworkPolicyEgressRule,
  NetworkPolicyFromPodSetInput,
  NetworkPolicyIngressRule,
  NetworkPolicyPeer,
  PodSpecInput,
  PortInput,
  PortName,
  ProbeTarget,
  PvcRefName,
  SecretBackend,
  SecretEnvForPodInput,
  SecretEnvInput,
  SecretInput,
  SecretManifest,
  SecretMemberInput,
  SecretMemberInputFor,
  SecretMemberOptions,
  SecretMemberOptionsFor,
  SecretMembersOpts,
  SecretRefName,
  SelectorLabels,
  ServiceAccountRef,
  ServiceFromContainerInput,
  ServicePortSpec,
  TcpSocketAction,
  ValueEnvInput,
  VolumeFromPvcInput,
  VolumeMount,
  VolumeName,
  VolumeNamesOf
} from "@konfig.ts/k8s"
import type { ConfigMap, Namespace, SecretRef, Volume } from "@konfig.ts/k8s"

type Expect<T extends true> = T

type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false

type Has<T, K extends PropertyKey> = K extends keyof T ? true : false

type _SaRefIsCore = Expect<Equal<ServiceAccountRef<"api">, CoreServiceAccountRef<"api">>>

type _RefNames = Expect<
  Equal<
    [SecretRefName<SecretRef<"s">>, ConfigMapRefName<ReturnType<typeof ConfigMap.make<"c">>["ref"]>, PvcRefName<never>],
    [CoreSecretRefName<SecretRef<"s">>, "c", CorePvcRefName<never>]
  >
>

type _Container = Expect<Has<ContainerInput, "name" | "image" | "env" | "ports">>

type _ContainerSpec = Expect<Has<ContainerSpec<"http", "data">, "name" | "image" | "ports" | "volumeMounts">>

type _DefineContainer = Expect<Has<DefineContainerInput<"http", "data", readonly []>, "name" | "ports" | "env">>

type _Pod = Expect<Has<DefinePodInput<"data">, "volumes" | "containers">>

type _DefinedPod = Expect<Has<DefinedPod<"data">, "volumes" | "containers">>

type _PodSpec = Expect<Has<PodSpecInput, "containers" | "volumes" | "imagePullSecrets" | "serviceAccountName">>

type _Port = Expect<Has<PortInput<"http">, "name" | "containerPort">>

type _ContainerPort = Expect<Has<ContainerPort<"http">, "name" | "containerPort">>

type _Protocol = Expect<Equal<ContainerProtocol, "TCP" | "UDP" | "SCTP">>

type _Probes = Expect<
  Equal<
    [Has<HttpGetAction<"http">, "port">, Has<TcpSocketAction<"http">, "port">, Has<GrpcAction<"http">, "port">],
    [true, true, true]
  >
>

type _Exec = Expect<Has<ExecAction, "command">>

type _Header = Expect<Has<HttpHeader, "name" | "value">>

type _Probe = Expect<Has<ProbeTarget<"http">, "httpGet" | "tcpSocket" | "grpc" | "exec">>

type _PortName = Expect<Equal<PortName<"http"> extends string ? true : false, true>>

type _NamesOf = Expect<Equal<NamesOf<readonly [ContainerPort<"http">, ContainerPort<"grpc">]>, "http" | "grpc">>

type _ServicePort = Expect<Has<ServicePortSpec<"http">, "port" | "targetPort">>

type _EnvInputs = Expect<
  Equal<
    [
      Has<ValueEnvInput<"X">, "name" | "value">,
      Has<SecretEnvInput<"X", "s", "k">, "ref" | "key">,
      Has<SecretEnvForPodInput<"X", "s", "k", "app">, "ref" | "key" | "podNamespace">,
      Has<ConfigMapEnvInput<"X", "c", "k">, "ref" | "key">,
      Has<EnvVarSource, "secretKeyRef" | "configMapKeyRef" | "fieldRef">
    ],
    [true, true, true, true, true]
  >
>

type _Identity = Expect<
  Equal<
    [
      Has<ConfigMapInput<"c">, "name" | "namespace" | "data">,
      Has<ConfigMapManifest<"c">, "ref" | "render">,
      Has<NamespaceInput<"n">, "name">,
      Has<NamespaceManifest<"n">, "ref">,
      Has<SecretInput<"s">, "name" | "namespace" | "stringData">,
      Has<SecretManifest<"s">, "ref">
    ],
    [true, true, true, true, true, true]
  >
>

type _NamespaceRef = Expect<Equal<ReturnType<typeof Namespace.make<"n">>, NamespaceManifest<"n">>>

type _Backend = Expect<Has<SecretBackend<"n", "k">, "_tag" | "requiresSource" | "emit">>

type _EmitInput = Expect<Has<BackendEmitInput<"n", "k">, "name" | "namespace" | "keys" | "source">>

type _Tag = Expect<Equal<Extract<BackendTag, "NativeSecret">, "NativeSecret">>

type _Native = Expect<Has<NativeSecretOptions, "type" | "immutable" | "silenceWarning">>

type _Network = Expect<Has<ServiceFromContainerInput<"http">, "name" | "namespace" | "forContainer" | "ports">>

type _NetPolPeer = Expect<Has<NetworkPolicyPeer, "podSet" | "namespaceSelector" | "ipBlock">>

type _NetPolRules = Expect<
  Equal<[Has<NetworkPolicyIngressRule, "from" | "ports">, Has<NetworkPolicyEgressRule, "to" | "ports">], [true, true]>
>

type _NetPolFromPodSet = Expect<Has<NetworkPolicyFromPodSetInput<{ app: "api" }>, "podSet">>

type _Hash = Expect<Has<HashSecretValuesInput, "values" | "salt">>

type _Workload = Expect<Has<DeploymentInput, "name" | "namespace" | "selector" | "template" | "replicas">>

type _WorkloadFromPodSet = Expect<Has<DeploymentFromPodSetInput<{ app: "api" }>, "podSet" | "template">>

type _Volumes = Expect<
  Equal<
    [
      Has<VolumeFromPvcInput<"v", "data">, "name" | "claim">,
      Has<VolumeMount<"v">, "name" | "mountPath">,
      VolumeName<"v"> extends string ? true : false,
      VolumeNamesOf<readonly [Volume<"a">, Volume<"b">]>
    ],
    [true, true, true, "a" | "b"]
  >
>

type _Selector = Expect<Equal<SelectorLabels<{ readonly app: "api" }> extends object ? true : false, true>>

type Db = SecretEntry<"db", "url", { readonly url: "DATABASE_URL" }>

type Port = LiteralEntry<"PORT", number>

type Members = { readonly db: Db; readonly port: Port }

type _Bind = Expect<Has<BindEnvironmentInput<Members>, "env" | "secrets">>

type _BindSecret = Expect<Has<BindSecretInput<"db", "url", { readonly url: "DATABASE_URL" }>, "secret">>

type _Declared = Expect<
  Equal<
    [
      Has<DeclaredEnvironment<Members>, "envVars" | "manifests" | "members" | "valuesLayer">,
      Has<DeclaredSecret<"db", "url">, "ref">,
      Has<DeclaredLiteral<"PORT", number>, "envName" | "value" | "envVar">,
      Has<DeclaredDownward<"POD">, "fieldPath" | "envVar">,
      Equal<DeclaredMember<Port>, DeclaredLiteral<"PORT", number>>
    ],
    [true, true, true, true, true]
  >
>

type _SecretMembers = Expect<
  Equal<
    [
      HasSecrets<Members>,
      Equal<SecretMemberInputFor<Db>, SecretMemberInput<"db", "url">>,
      Equal<SecretMemberOptionsFor<Db>, SecretMemberOptions<"db", "url">>,
      Has<SecretMembersOpts<Members>, "db">
    ],
    [true, true, true, true]
  >
>

export type _Tests = readonly [
  _SaRefIsCore,
  _RefNames,
  _Container,
  _ContainerSpec,
  _DefineContainer,
  _Pod,
  _DefinedPod,
  _PodSpec,
  _Port,
  _ContainerPort,
  _Protocol,
  _Probes,
  _Exec,
  _Header,
  _Probe,
  _PortName,
  _NamesOf,
  _ServicePort,
  _EnvInputs,
  _Identity,
  _NamespaceRef,
  _Backend,
  _EmitInput,
  _Tag,
  _Native,
  _Network,
  _NetPolPeer,
  _NetPolRules,
  _NetPolFromPodSet,
  _Hash,
  _Workload,
  _WorkloadFromPodSet,
  _Volumes,
  _Selector,
  _Bind,
  _BindSecret,
  _Declared,
  _SecretMembers
]
