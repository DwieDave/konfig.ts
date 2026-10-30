import { Environment as _EnvironmentContract, runtime as envRuntime, Secret as _SecretContract } from "@konfig.ts/env"
import { bindEnvironment } from "./environmentBind"
import { Secret as _SecretIdentity } from "./identity"
import { bindSecret } from "./secretBind"

export { Backend } from "./api"

export { Container, Pod } from "./container"

export { Port } from "./ports"

export { EnvVar } from "./env"

export { ConfigMap, Namespace } from "./identity"

export const Secret = { ..._SecretContract, ..._SecretIdentity, bind: bindSecret }

export const Environment = {
  ..._EnvironmentContract,
  bind: bindEnvironment,
  runtime: envRuntime
}

export { NativeSecret } from "./nativeSecret"

export { Service } from "./network"

export { hashSecretValues } from "./podHash"

export { NetworkPolicy } from "./policy"

export { PvcRef } from "./refs"

export { Volume } from "./volume"

export { Deployment } from "./workload"

export { Selector } from "./selector"

export * as Workload from "./workloadHelpers"
