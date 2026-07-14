/**
 * Cluster identity helpers. `cluster` is the default single-cluster
 * spec used by `envs/prod.ts` and `envs/staging.ts`; for the
 * multi-cluster demo, `clusters` records per-region overlays consumed
 * by `envs/prod-eu.ts` and `envs/prod-us.ts`.
 *
 * In a real setup the per-cluster registry / ingress / storage class
 * would be the actually-different fields; the rest of the konfig
 * modules read off `ctx.cluster` in `Manifest.make((ctx) => ...)` and
 * pick the matching `clusters[ctx.cluster!]` entry.
 */
export const cluster = {
  domain: "example.dev",
  repositoryUrl: "ssh://git@github.com/example/full-stack.git"
} as const

export type Cluster = typeof cluster

export interface ClusterOverlay {
  readonly registry: string
  readonly ingressClass: string
  readonly storageClass: string
  readonly domain: string
}

export const clusters = {
  "eu-west-1": {
    registry: "ghcr.io/example",
    ingressClass: "nginx",
    storageClass: "gp3",
    domain: "eu.example.dev"
  },
  "us-east-1": {
    registry: "123456789012.dkr.ecr.us-east-1.amazonaws.com/example",
    ingressClass: "alb",
    storageClass: "gp3-iops",
    domain: "us.example.dev"
  }
} as const satisfies Readonly<Record<string, ClusterOverlay>>

export type ClusterName = keyof typeof clusters
