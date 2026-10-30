// Pinned re-export of Kubernetes API types. The directory name is
// historical — we don't regenerate from OpenAPI; we re-export the
// pinned `kubernetes-types` package, which is itself a stable mirror
// of the upstream Kubernetes Go types.
//
// Version policy: `kubernetes-types` is pinned with a tilde range
// (~1.30.0) in packages/k8s/package.json, allowing patch bumps only.
// The minor (currently 1.30) tracks the cluster minor we test
// against. Bumping the minor is intentional: read upstream release
// notes, run `bun run check && bun run test`, and update CHANGELOG.
//
// Each export here is the K8s API type as-is. konfig wrappers (e.g.
// `ContainerInput` in container.ts) accept a wider, branded shape
// and lower into these types when emitting manifests.

export type { Deployment, DeploymentStrategy } from "kubernetes-types/apps/v1"

export type {
  ConfigMap,
  Container,
  Namespace,
  PodSpec,
  PodTemplateSpec,
  Secret,
  Service,
  ServicePort,
  Volume
} from "kubernetes-types/core/v1"

export type {
  Ingress,
  IngressBackend,
  IngressRule,
  NetworkPolicy,
  NetworkPolicyEgressRule,
  NetworkPolicyIngressRule,
  NetworkPolicyPeer
} from "kubernetes-types/networking/v1"
