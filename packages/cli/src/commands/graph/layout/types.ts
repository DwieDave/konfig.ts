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
  readonly width: number
  readonly withDev: boolean
  readonly reduce?: boolean
}

export interface CycleInput {
  readonly nodes: ReadonlyArray<GraphNode>
  readonly edges: ReadonlyArray<GraphEdge>
  readonly withDev?: boolean
  readonly target?: string
}

export interface LayoutNodeData {
  readonly name: string
  readonly real: GraphNode | null
  readonly rank: number
}

export interface LayoutEdgeData {
  readonly from: string
  readonly to: string
  readonly kind: EdgeKind
  readonly isFinal: boolean
}

export interface LaidNode {
  readonly data: LayoutNodeData
  readonly boxStartX: number
  readonly boxWidth: number
  readonly layerIndex: number
}

export interface SlotMap {
  readonly outgoingSlotX: Map<string, number>
  readonly incomingSlotX: Map<string, number>
}

export interface LinkLike {
  readonly from: string
  readonly to: string
}

export const BUILD_TOKEN = "build"
export const BOX_ROWS = 4
export const MIN_ROUTE_ROWS = 3
