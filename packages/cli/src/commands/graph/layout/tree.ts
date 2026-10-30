import { adjacency, reverseAdjacency } from "./adjacency"
import { BUILD_TOKEN, type EdgeKind, type GraphEdge, type GraphNode } from "./types"

interface TreeContext {
  readonly adj: ReadonlyMap<string, ReadonlyArray<string>>
  readonly edges: ReadonlyArray<GraphEdge>
  readonly byName: ReadonlyMap<string, GraphNode>
  readonly seen: Set<string>
  readonly lines: string[]
}

interface WalkInput {
  readonly ctx: TreeContext
  readonly name: string
  readonly prefix: string
  readonly isLast: boolean
  readonly isRoot: boolean
  readonly edgeKind: EdgeKind | null
}

const _formatNode = (input: { readonly node: GraphNode; readonly suffix: string }): string => {
  const build = input.node.hasBuildScript ? `  ${BUILD_TOKEN}` : ""

  return `${input.node.name}  ${input.node.relDir}${build}${input.suffix}`
}

const _connector = (input: { readonly isRoot: boolean; readonly isLast: boolean }): string => {
  if (input.isRoot) return ""

  return input.isLast ? "└── " : "├── "
}

const _childLinks = (input: { readonly ctx: TreeContext; readonly name: string }) =>
  (input.ctx.adj.get(input.name) ?? []).slice().sort().map((child) => ({
    name: child,
    kind: input.ctx.edges.find((e) => e.from === input.name && e.to === child)?.kind ?? "runtime"
  }))

const _walk = (input: WalkInput): void => {
  const { ctx, name, prefix, isLast, isRoot, edgeKind } = input
  const node = ctx.byName.get(name)

  if (!node) return
  const connector = _connector({ isRoot, isLast })
  const kindTag = edgeKind === "dev" ? "  (dev)" : ""

  if (ctx.seen.has(name)) {
    ctx.lines.push(`${prefix}${connector}${node.name}${kindTag}  (see above)`)

    return
  }

  ctx.seen.add(name)
  ctx.lines.push(`${prefix}${connector}${_formatNode({ node, suffix: kindTag })}`)
  const links = _childLinks({ ctx, name })
  const childPrefix = isRoot ? "" : prefix + (isLast ? "    " : "│   ")
  links.forEach((link, i) =>
    _walk({
      ctx,
      name: link.name,
      prefix: childPrefix,
      isLast: i === links.length - 1,
      isRoot: false,
      edgeKind: link.kind
    })
  )
}

const _roots = (input: {
  readonly nodes: ReadonlyArray<GraphNode>
  readonly edges: ReadonlyArray<GraphEdge>
}): string[] => {
  const rev = reverseAdjacency(input.edges)

  return input.nodes.filter((n) => (rev.get(n.name)?.length ?? 0) === 0).map((n) => n.name).sort()
}

export const renderTree = (input: {
  readonly nodes: ReadonlyArray<GraphNode>
  readonly edges: ReadonlyArray<GraphEdge>
  readonly target: string | undefined
}): string => {
  const ctx: TreeContext = {
    adj: adjacency(input.edges),
    edges: input.edges,
    byName: new Map(input.nodes.map((n) => [n.name, n])),
    seen: new Set(),
    lines: []
  }

  const roots = input.target === undefined ? _roots(input) : [input.target]
  roots.forEach((name, i) =>
    _walk({
      ctx,
      name,
      prefix: "",
      isLast: input.target !== undefined || i === roots.length - 1,
      isRoot: true,
      edgeKind: null
    })
  )

  return ctx.lines.join("\n")
}
