import type { LaidNode, LayoutEdgeData, SlotMap } from "./types"

const SLOT_GAP = 2
const VISUAL_GAP = 4

const _nodeCenter = (ln: LaidNode): number => ln.boxStartX + Math.floor(ln.boxWidth / 2)

interface Bounds {
  readonly min: number
  readonly max: number
  readonly minGap: number
}

const _enforceForward = (input: { readonly slots: ReadonlyArray<number>; readonly minGap: number }): number[] =>
  input.slots.reduce<number[]>((acc, s, i) => [...acc, i === 0 ? s : Math.max(s, (acc[i - 1] ?? s) + input.minGap)], [])

const _enforceBackward = (input: { readonly slots: ReadonlyArray<number>; readonly bounds: Bounds }): number[] => {
  const { slots, bounds } = input
  if ((slots[slots.length - 1] ?? bounds.min) <= bounds.max) return slots.slice()
  const out = slots.slice()
  out[out.length - 1] = bounds.max
  for (let i = out.length - 2; i >= 0; i--) {
    out[i] = Math.min(out[i] ?? bounds.min, (out[i + 1] ?? bounds.max) - bounds.minGap)
  }
  return out
}

const _packedRun = (input: { readonly slots: ReadonlyArray<number>; readonly bounds: Bounds }): number => {
  const { slots, bounds } = input
  const firstGap = slots.findIndex((s, i) => s !== bounds.min + i * bounds.minGap)
  return firstGap === -1 ? slots.length : firstGap
}

const _spreadLeadingRun = (input: { readonly slots: ReadonlyArray<number>; readonly bounds: Bounds }): number[] => {
  const { slots, bounds } = input
  const run = _packedRun(input)
  if (run <= 1) return slots.slice()
  const bound = run < slots.length ? (slots[run] ?? bounds.max) - bounds.minGap : bounds.max
  const span = Math.max(0, bound - bounds.min)
  const used = Math.min(span, (run - 1) * Math.max(bounds.minGap, VISUAL_GAP))
  return slots.map((s, i) => (i < run ? bounds.min + Math.round(i / (run - 1) * used) : s))
}

const _mirror = (slots: ReadonlyArray<number>): number[] => slots.map((s) => -s).reverse()

const _mirrorBounds = (bounds: Bounds): Bounds => ({ min: -bounds.max, max: -bounds.min, minGap: bounds.minGap })

const _allocateMonotonic = (input: {
  readonly ideals: ReadonlyArray<number>
  readonly bounds: Bounds
}): number[] => {
  const { ideals, bounds } = input
  const clamped = ideals.map((x) => Math.max(bounds.min, Math.min(bounds.max, x)))
  const spaced = _enforceBackward({ slots: _enforceForward({ slots: clamped, minGap: bounds.minGap }), bounds })
    .map((s) => Math.max(s, bounds.min))
  const left = _spreadLeadingRun({ slots: spaced, bounds })
  const mirrored = _mirrorBounds(bounds)
  return _mirror(_spreadLeadingRun({ slots: _mirror(left), bounds: mirrored }))
}

const _toSlotMap = (input: { readonly keys: ReadonlyArray<string>; readonly xs: ReadonlyArray<number> }) =>
  new Map(input.keys.flatMap((key, i): Array<[string, number]> => {
    const x = input.xs[i]
    return x === undefined ? [] : [[key, x]]
  }))

const _boxBounds = (laid: LaidNode): Bounds => ({
  min: laid.boxStartX + 1,
  max: laid.boxStartX + laid.boxWidth - 2,
  minGap: SLOT_GAP
})

const _dummySlots = (input: {
  readonly laid: LaidNode
  readonly outEdges: ReadonlyArray<LayoutEdgeData>
  readonly inEdges: ReadonlyArray<LayoutEdgeData>
}): SlotMap => {
  const x = _nodeCenter(input.laid)
  return {
    outgoingSlotX: new Map(input.outEdges.map((e) => [e.to, x])),
    incomingSlotX: new Map(input.inEdges.map((e) => [e.from, x]))
  }
}

const _centerOf = (input: { readonly positions: ReadonlyMap<string, LaidNode>; readonly name: string }): number => {
  const node = input.positions.get(input.name)
  return node ? _nodeCenter(node) : 0
}

const _outgoingSlots = (input: {
  readonly laid: LaidNode
  readonly outEdges: ReadonlyArray<LayoutEdgeData>
  readonly positions: ReadonlyMap<string, LaidNode>
}): Map<string, number> => {
  const { laid, positions } = input
  const centerOf = (name: string): number => _centerOf({ positions, name })
  const ordered = input.outEdges.slice().sort((a, b) => {
    const ax = centerOf(a.to)
    const bx = centerOf(b.to)
    return ax === bx ? a.to.localeCompare(b.to) : ax - bx
  })
  const ideals = ordered.map((e) => positions.has(e.to) ? centerOf(e.to) : _nodeCenter(laid))
  const xs = _allocateMonotonic({ ideals, bounds: _boxBounds(laid) })
  return _toSlotMap({ keys: ordered.map((e) => e.to), xs })
}

const _incomingIdeals = (input: { readonly laid: LaidNode; readonly count: number }): number[] => {
  const { laid, count } = input
  const center = _nodeCenter(laid)
  const spacing = count > 1 ? Math.max(1, laid.boxWidth - 2) / (count + 1) : 0
  return Array.from(
    { length: count },
    (_unused, i) => count === 1 ? center : Math.round(center + (i - (count - 1) / 2) * spacing)
  )
}

const _incomingSlots = (input: {
  readonly laid: LaidNode
  readonly inEdges: ReadonlyArray<LayoutEdgeData>
  readonly positions: ReadonlyMap<string, LaidNode>
  readonly slotsByNode: ReadonlyMap<string, SlotMap>
}): Map<string, number> => {
  const { laid, positions, slotsByNode } = input
  const anchorOf = (from: string): number =>
    slotsByNode.get(from)?.outgoingSlotX.get(laid.data.name) ?? _centerOf({ positions, name: from })
  const ordered = input.inEdges.slice().sort((a, b) => {
    const ax = anchorOf(a.from)
    const bx = anchorOf(b.from)
    return ax === bx ? a.from.localeCompare(b.from) : ax - bx
  })
  const ideals = _incomingIdeals({ laid, count: ordered.length })
  const xs = _allocateMonotonic({ ideals, bounds: _boxBounds(laid) })
  return _toSlotMap({ keys: ordered.map((e) => e.from), xs })
}

export const computeNodeSlots = (input: {
  readonly laid: LaidNode
  readonly edges: ReadonlyArray<LayoutEdgeData>
  readonly positions: ReadonlyMap<string, LaidNode>
  readonly slotsByNode: ReadonlyMap<string, SlotMap>
}): SlotMap => {
  const { laid, positions, slotsByNode } = input
  const outEdges = input.edges.filter((e) => e.from === laid.data.name)
  const inEdges = input.edges.filter((e) => e.to === laid.data.name)
  if (laid.data.real === null) return _dummySlots({ laid, outEdges, inEdges })
  return {
    outgoingSlotX: _outgoingSlots({ laid, outEdges, positions }),
    incomingSlotX: _incomingSlots({ laid, inEdges, positions, slotsByNode })
  }
}
