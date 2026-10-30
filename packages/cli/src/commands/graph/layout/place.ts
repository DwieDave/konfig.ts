import { BUILD_TOKEN, type LaidNode, type LayoutEdgeData, type LayoutNodeData } from "./types"

const GUTTER = 3
const DUMMY_WIDTH = 3
const MIN_BOX_WIDTH = 5

const _degree = (input: {
  readonly name: string
  readonly edges: ReadonlyArray<LayoutEdgeData>
  readonly side: "from" | "to"
}): number => input.edges.filter((e) => e[input.side] === input.name).length

const _boxWidth = (input: {
  readonly node: LayoutNodeData
  readonly edges: ReadonlyArray<LayoutEdgeData>
}): number => {
  const real = input.node.real
  if (real === null) return DUMMY_WIDTH
  const buildSeg = real.hasBuildScript ? BUILD_TOKEN.length + 1 : 0
  const { name } = input.node
  return Math.max(
    real.name.length + 4,
    real.relDir.length + buildSeg + 4,
    2 * _degree({ name, edges: input.edges, side: "from" }) + 1,
    2 * _degree({ name, edges: input.edges, side: "to" }) + 1,
    MIN_BOX_WIDTH
  )
}

const _layerWidth = (widths: ReadonlyArray<number>): number =>
  widths.reduce((acc, w, i) => acc + w + (i > 0 ? GUTTER : 0), 0)

const _layoutLayer = (input: {
  readonly layer: ReadonlyArray<LayoutNodeData>
  readonly widths: ReadonlyArray<number>
  readonly layerIndex: number
  readonly startOffset: number
}): LaidNode[] => {
  let cursor = input.startOffset
  return input.layer.map((data, i): LaidNode => {
    const boxWidth = input.widths[i] ?? 0
    const laid = { data, boxStartX: cursor, boxWidth, layerIndex: input.layerIndex }
    cursor += boxWidth + GUTTER
    return laid
  })
}

export const layoutLayers = (input: {
  readonly layers: ReadonlyArray<ReadonlyArray<LayoutNodeData>>
  readonly edges: ReadonlyArray<LayoutEdgeData>
}): { canvas: LaidNode[][]; canvasWidth: number } => {
  const widths = input.layers.map((layer) => layer.map((node) => _boxWidth({ node, edges: input.edges })))
  const layerWidths = widths.map(_layerWidth)
  const canvasWidth = Math.max(0, ...layerWidths)
  const canvas = input.layers.map((layer, layerIndex) =>
    _layoutLayer({
      layer,
      widths: widths[layerIndex] ?? [],
      layerIndex,
      startOffset: Math.floor((canvasWidth - (layerWidths[layerIndex] ?? 0)) / 2)
    })
  )
  return { canvas, canvasWidth }
}
