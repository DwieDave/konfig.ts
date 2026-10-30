import {
  allWorkspaces,
  CircularWorkspaceDep,
  findRoot,
  lookupWorkspace,
  type Workspace,
  workspaceDeps
} from "@konfig.ts/docker"
import { Console, Data, Effect, Option } from "effect"
import { Argument, Command, Flag } from "effect/cli"
import { Path } from "effect/Path"
import { detectCycle, type GraphEdge, type GraphNode, renderGraph } from "./graph/layout"

class GraphTargetNotFound extends Data.TaggedError("GraphTargetNotFound")<{
  readonly target: string
  readonly candidates: ReadonlyArray<string>
}> {
  get message(): string {
    return `workspace '${this.target}' not found. Available workspaces: ${this.candidates.join(", ")}`
  }
}

const _buildEdges = (workspaces: ReadonlyArray<Workspace>): GraphEdge[] =>
  workspaces.flatMap((ws) =>
    workspaceDeps({ ws, names: workspaces.map((w) => w.name), includeDev: true }).map(({ to, kind }) => ({
      from: ws.name,
      to,
      kind
    }))
  )

interface RunGraphArgs {
  readonly cwd: string
  readonly target: Option.Option<string>
  readonly withDev: boolean
  readonly full: boolean
}

const _resolveTarget = (input: {
  readonly workspaces: ReadonlyArray<Workspace>
  readonly target: Option.Option<string>
  readonly cwd: string
  readonly root: string
}) =>
  Effect.gen(function*() {
    if (Option.isNone(input.target)) return undefined
    const found = lookupWorkspace({ ...input, target: input.target.value })

    if (found) return found.name

    return yield* new GraphTargetNotFound({
      target: input.target.value,
      candidates: input.workspaces.map((w) => w.name)
    })
  })

const _toNodes = (workspaces: ReadonlyArray<Workspace>): GraphNode[] =>
  workspaces.map((w) => ({ name: w.name, relDir: w.relDir, hasBuildScript: w.hasBuildScript }))

const _graphOutput = (input: {
  readonly workspaces: ReadonlyArray<Workspace>
  readonly target: string | undefined
  readonly withDev: boolean
  readonly full: boolean
}) =>
  Effect.gen(function*() {
    const nodes = _toNodes(input.workspaces)
    const edges = _buildEdges(input.workspaces)
    const { target, withDev } = input
    const cycle = detectCycle({ nodes, edges, withDev, target })

    if (cycle !== null) return yield* new CircularWorkspaceDep({ cycle: cycle.slice() })

    return renderGraph({ nodes, edges, target, withDev, reduce: !input.full })
  })

export const runGraph = (args: RunGraphArgs) =>
  Effect.gen(function*() {
    const p = yield* Path
    const cwd = p.resolve(args.cwd)
    const root = yield* findRoot(cwd)
    const workspaces = yield* allWorkspaces(root)
    const target = yield* _resolveTarget({ workspaces, target: args.target, cwd, root })
    const out = yield* _graphOutput({ workspaces, target, withDev: args.withDev, full: args.full })
    yield* Console.log(out)
  })

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
      Flag.withDescription("also draw devDependency edges (annotated with (dev))"),
      Flag.withDefault(false)
    ),
    full: Flag.Boolean("full").pipe(
      Flag.withDescription(
        "show every direct edge (default hides transitively-implied edges, e.g. A→C when A→B→C exists)"
      ),
      Flag.withDefault(false)
    )
  },
  (args) => runGraph({ ...args, cwd: process.cwd() })
).pipe(
  Command.withDescription(
    "Print an ASCII graph of the workspace dependency closure (or the whole monorepo when no target given)"
  )
)
