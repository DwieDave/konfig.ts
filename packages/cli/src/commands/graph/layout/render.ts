import { activeEdges, dedupeEdges, reachableFromTarget, transitiveReduce } from "./adjacency"
import { renderTree } from "./tree"
import { BUILD_TOKEN, type GraphEdge, type RenderInput, type Scope } from "./types"

const _plural = (n: number): string => (n === 1 ? "" : "s")

const _renderHeader = (input: {
  readonly target: string | undefined
  readonly edges: ReadonlyArray<GraphEdge>
  readonly nodeCount: number
  readonly withDev: boolean
  readonly reduce: boolean
}): string => {
  const count = (kind: GraphEdge["kind"]): number => input.edges.filter((e) => e.kind === kind).length

  const parts = [
    `${input.nodeCount} workspaces`,
    `${count("runtime")} runtime edge${_plural(count("runtime"))}`,
    ...(input.withDev ? [`${count("dev")} dev edge${_plural(count("dev"))}`] : []),
    ...(input.reduce ? [] : ["full"])
  ]

  const label = input.target ? `closure: ${input.target}` : "monorepo workspaces"

  return `${label}  ·  ${parts.join("  ·  ")}`
}

const _renderLegend = (input: { readonly withDev: boolean; readonly showBuild: boolean }): string => {
  const items = [
    ...(input.showBuild ? [`${BUILD_TOKEN} = has build script`] : []),
    ...(input.withDev ? ["(dev) = dev edge"] : [])
  ]

  return `legend:  ${items.join("   ")}`
}

const _scopeOf = (input: RenderInput): Scope => {
  const filtered = activeEdges({ edges: dedupeEdges(input.edges), withDev: input.withDev })

  const scope = input.target !== undefined
    ? reachableFromTarget({ nodes: input.nodes, edges: filtered, target: input.target })
    : { nodes: input.nodes, edges: filtered }

  return { nodes: scope.nodes, edges: input.reduce ? transitiveReduce(scope.edges) : scope.edges }
}

const _emptyMessage = (target: string | undefined): string =>
  target !== undefined ? `(target '${target}' not found in workspace set)` : "(no workspaces found)"

export const renderGraph = (input: RenderInput): string => {
  const { nodes, edges } = _scopeOf(input)

  if (nodes.length === 0) return _emptyMessage(input.target)

  const header = _renderHeader({
    target: input.target,
    edges,
    nodeCount: nodes.length,
    withDev: input.withDev,
    reduce: input.reduce
  })

  const legend = _renderLegend({ withDev: input.withDev, showBuild: nodes.some((n) => n.hasBuildScript) })

  return [header, "", renderTree({ nodes, edges, target: input.target }), "", legend].join("\n")
}
