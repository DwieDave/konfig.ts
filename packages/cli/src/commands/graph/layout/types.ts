export interface GraphNode {
  readonly name: string
  readonly relDir: string
  readonly hasBuildScript: boolean
}

export type EdgeKind = "runtime" | "dev"

export interface GraphEdge {
  readonly from: string
  readonly to: string
  readonly kind: EdgeKind
}

export interface RenderInput {
  readonly nodes: ReadonlyArray<GraphNode>
  readonly edges: ReadonlyArray<GraphEdge>
  readonly target: string | undefined
  readonly withDev: boolean
  readonly reduce: boolean
}

export interface Scope {
  readonly nodes: ReadonlyArray<GraphNode>
  readonly edges: ReadonlyArray<GraphEdge>
}

export interface LinkLike {
  readonly from: string
  readonly to: string
}

export const BUILD_TOKEN = "build"
