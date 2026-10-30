import type { DeploymentInput, ServiceFromContainerInput, ServiceFromPodSetInput, ServiceInput } from "@konfig.ts/k8s"

type Expect<T extends true> = T

type Has<T, K extends PropertyKey> = K extends keyof T ? true : false

type _Svc = Expect<Has<ServiceInput, "name" | "namespace" | "labels" | "annotations" | "type">>

type _SvcC = Expect<Has<ServiceFromContainerInput<"http">, "name" | "namespace" | "type">>

type _SvcP = Expect<Has<ServiceFromPodSetInput<{ a: "b" }>, "name" | "namespace" | "type">>

type _Dep = Expect<Has<DeploymentInput, "name" | "namespace" | "selector" | "template" | "replicas">>
