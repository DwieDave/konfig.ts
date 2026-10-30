import { allWorkspaces, CircularWorkspaceDep, findRoot, type Workspace } from "@konfig.ts/docker"
import { Console, Data, Effect, Option } from "effect"
import { Argument, Command, Flag } from "effect/cli"
import { Path } from "effect/Path"
import { detectCycle, type EdgeKind, type GraphEdge, type GraphNode, renderGraph } from "./graph/layout"

class GraphTargetNotFound extends Data.TaggedError("GraphTargetNotFound")<{
  readonly target: string
  readonly candidates: ReadonlyArray<string>
}> {}

const _depEdges = (input: {
  readonly workspace: Workspace
  readonly names: ReadonlySet<string>
  readonly record: Readonly<Record<string, string>> | undefined
  readonly kind: EdgeKind
}): GraphEdge[] =>
  Object.keys(input.record ?? {}).flatMap((to): GraphEdge[] =>
    input.names.has(to) ? [{ from: input.workspace.name, to, kind: input.kind }] : []
  )

const _buildEdges = (workspaces: ReadonlyArray<Workspace>): GraphEdge[] => {
  const names = new Set(workspaces.map((w) => w.name))
  return workspaces.flatMap((workspace) => [
    ..._depEdges({ workspace, names, record: workspace.pkg.dependencies, kind: "runtime" }),
    ..._depEdges({ workspace, names, record: workspace.pkg.peerDependencies, kind: "runtime" }),
    ..._depEdges({ workspace, names, record: workspace.pkg.devDependencies, kind: "dev" })
  ])
}

const _resolveTargetName = (input: {
  readonly workspaces: ReadonlyArray<Workspace>
  readonly rawTarget: string
}): string | undefined =>
  (input.workspaces.find((w) => w.name === input.rawTarget) ??
    input.workspaces.find((w) => w.relDir === input.rawTarget))?.name

const _detectWidth = (override: Option.Option<number>): number => {
  if (Option.isSome(override)) return override.value
  const cols = process.stdout.columns
  return typeof cols === "number" && cols > 0 ? cols : 100
}

export interface RunGraphArgs {
  readonly cwd: string
  readonly target: Option.Option<string>
  readonly withDev: boolean
  readonly full: boolean
  readonly width: Option.Option<number>
}

const _resolveTarget = (input: {
  readonly workspaces: ReadonlyArray<Workspace>
  readonly target: Option.Option<string>
}) =>
  Effect.gen(function*() {
    if (Option.isNone(input.target)) return undefined
    const resolved = _resolveTargetName({ workspaces: input.workspaces, rawTarget: input.target.value })
    if (resolved) return resolved
    return yield* new GraphTargetNotFound({
      target: input.target.value,
      candidates: input.workspaces.map((w) => w.name)
    })
  })

const _logTargetNotFound = (err: GraphTargetNotFound) =>
  Effect.gen(function*() {
    yield* Console.error(`error: workspace '${err.target}' not found. Available workspaces:`)
    for (const name of err.candidates) yield* Console.error(`  ${name}`)
    return yield* err
  })

const _logCycle = (err: CircularWorkspaceDep) =>
  Effect.gen(function*() {
    yield* Console.error(`error: workspace cycle detected: ${err.cycle.join(" → ")}`)
    return yield* err
  })

export const runGraph = (
  args: RunGraphArgs
) =>
  Effect.gen(function*() {
    const p = yield* Path
    const root = yield* findRoot(p.resolve(args.cwd))
    const workspaces = yield* allWorkspaces(root)
    const nodes: GraphNode[] = workspaces.map((w) => ({
      name: w.name,
      relDir: w.relDir,
      hasBuildScript: w.hasBuildScript
    }))
    const edges = _buildEdges(workspaces)
    const target = yield* _resolveTarget({ workspaces, target: args.target })
    const cycle = detectCycle({ nodes, edges, withDev: args.withDev, target })
    if (cycle !== null) return yield* new CircularWorkspaceDep({ cycle: cycle.slice() })
    const out = renderGraph({
      nodes,
      edges,
      target,
      width: _detectWidth(args.width),
      withDev: args.withDev,
      reduce: !args.full
    })
    yield* Console.log(out)
  }).pipe(
    Effect.catchTags({ GraphTargetNotFound: _logTargetNotFound, CircularWorkspaceDep: _logCycle })
  )

export const graphCommand = Command.make(
  "graph",
  {
    target: Argument.String("target")
      .pipe(
        Argument.withDescription(
          "workspace dir or name; omit to render the whole monorepo"
        ),
        Argument.optional
      ),
    withDev: Flag.Boolean("with-dev").pipe(
      Flag.withDescription("also draw devDependency edges (annotated with ▽)"),
      Flag.withDefault(false)
    ),
    full: Flag.Boolean("full").pipe(
      Flag.withDescription(
        "show every direct edge (default hides transitively-implied edges, e.g. A→C when A→B→C exists)"
      ),
      Flag.withDefault(false)
    ),
    width: Flag.Int("width").pipe(
      Flag.withDescription(
        "override detected terminal width (defaults to stdout.columns or 100)"
      ),
      Flag.optional
    )
  },
  (args) => runGraph({ ...args, cwd: process.cwd() })
).pipe(
  Command.withDescription(
    "Print an ASCII graph of the workspace dependency closure (or the whole monorepo when no target given)"
  )
)
