// `cluster` is the default single-cluster spec; `clusters` records per-region overlays for the multi-cluster demo.
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
