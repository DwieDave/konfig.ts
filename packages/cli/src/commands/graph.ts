import {
	allWorkspaces,
	CircularWorkspaceDep,
	findRoot,
} from "@konfig.ts/docker";
import { Console, Data, Effect, Option } from "effect";
import { Path } from "effect/Path";
import { Argument, Command, Flag } from "../_unstable";
import {
	detectCycle,
	type GraphEdge,
	type GraphNode,
	renderGraph,
} from "./graph/layout";

class GraphTargetNotFound extends Data.TaggedError("GraphTargetNotFound")<{
	readonly target: string;
	readonly candidates: ReadonlyArray<string>;
}> {}

const WORKSPACE_PROTOCOLS = ["workspace:", "link:"] as const;

const _hasWorkspaceProtocol = (spec: string): boolean =>
	WORKSPACE_PROTOCOLS.some((p) => spec.startsWith(p));

interface WorkspaceLike {
	readonly name: string;
	readonly relDir: string;
	readonly hasBuildScript: boolean;
	readonly pkg: {
		readonly dependencies?: Record<string, string>;
		readonly peerDependencies?: Record<string, string>;
		readonly devDependencies?: Record<string, string>;
	};
}

const _buildEdges = (workspaces: ReadonlyArray<WorkspaceLike>): GraphEdge[] => {
	const workspaceNames = new Set(workspaces.map((w) => w.name));
	const edges: GraphEdge[] = [];
	const addEdges = (
		from: string,
		rec: Record<string, string> | undefined,
		kind: "runtime" | "dev",
	): void => {
		if (!rec) return;
		for (const [depName, spec] of Object.entries(rec)) {
			if (!workspaceNames.has(depName)) continue;
			if (!_hasWorkspaceProtocol(spec)) continue;
			edges.push({ from, to: depName, kind });
		}
	};
	for (const w of workspaces) {
		addEdges(w.name, w.pkg.dependencies, "runtime");
		addEdges(w.name, w.pkg.peerDependencies, "runtime");
		addEdges(w.name, w.pkg.devDependencies, "dev");
	}
	return edges;
};

const _resolveTargetName = (
	workspaces: ReadonlyArray<WorkspaceLike>,
	rawTarget: string,
): string | undefined => {
	const byName = workspaces.find((w) => w.name === rawTarget);
	if (byName) return byName.name;
	const byRelDir = workspaces.find((w) => w.relDir === rawTarget);
	if (byRelDir) return byRelDir.name;
	return undefined;
};

const _detectWidth = (override: Option.Option<number>): number => {
	if (Option.isSome(override)) return override.value;
	const cols = process.stdout.columns;
	return typeof cols === "number" && cols > 0 ? cols : 100;
};

export const graphCommand = Command.make(
	"graph",
	{
		target: Argument.string("target")
			.pipe(
				Argument.withDescription(
					"workspace dir or name; omit to render the whole monorepo",
				),
				Argument.optional,
			),
		withDev: Flag.boolean("with-dev").pipe(
			Flag.withDescription("also draw devDependency edges (annotated with ▽)"),
			Flag.withDefault(false),
		),
		full: Flag.boolean("full").pipe(
			Flag.withDescription(
				"show every direct edge (default hides transitively-implied edges, e.g. A→C when A→B→C exists)",
			),
			Flag.withDefault(false),
		),
		width: Flag.integer("width").pipe(
			Flag.withDescription(
				"override detected terminal width (defaults to stdout.columns or 100)",
			),
			Flag.optional,
		),
	},
	(args) =>
		Effect.gen(function* () {
			const p = yield* Path;
			const root = yield* findRoot(p.resolve(process.cwd()));
			const workspaces = yield* allWorkspaces(root);
			const nodes: GraphNode[] = workspaces.map((w) => ({
				name: w.name,
				relDir: w.relDir,
				hasBuildScript: w.hasBuildScript,
			}));
			const edges = _buildEdges(workspaces);
			let targetName: string | undefined = undefined;
			if (Option.isSome(args.target)) {
				const raw = args.target.value;
				const resolved = _resolveTargetName(workspaces, raw);
				if (!resolved) {
					return yield* Effect.fail(
						new GraphTargetNotFound({
							target: raw,
							candidates: workspaces.map((w) => w.name),
						}),
					);
				}
				targetName = resolved;
			}
			const cycle = detectCycle({ nodes, edges, withDev: args.withDev });
			if (cycle !== null) {
				return yield* Effect.fail(
					new CircularWorkspaceDep({ cycle: cycle.slice() }),
				);
			}
			const width = _detectWidth(args.width);
			const out = renderGraph({
				nodes,
				edges,
				target: targetName,
				width,
				withDev: args.withDev,
				reduce: !args.full,
			});
			yield* Console.log(out);
		}).pipe(
			Effect.catchTag("GraphTargetNotFound", (err) =>
				Effect.gen(function* () {
					yield* Console.error(
						`error: workspace '${err.target}' not found. Available workspaces:`,
					);
					for (const name of err.candidates) yield* Console.error(`  ${name}`);
					return yield* Effect.fail(
						new Error(`graph: target '${err.target}' not found`),
					);
				}),
			),
			Effect.catchTag("CircularWorkspaceDep", (err) =>
				Effect.gen(function* () {
					yield* Console.error(
						`error: workspace cycle detected: ${err.cycle.join(" → ")}`,
					);
					return yield* Effect.fail(
						new Error(`graph: workspace cycle detected`),
					);
				}),
			),
		),
).pipe(
	Command.withDescription(
		"Print an ASCII graph of the workspace dependency closure (or the whole monorepo when no target given)",
	),
);
