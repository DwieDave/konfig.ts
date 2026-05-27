import { Effect } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import {
	BuildScriptMissing,
	EngineVersionMissing,
	type AnyDockerError,
	SharedRootFileMissing,
	WorkspaceNotFound,
	WorkspaceSourceUnknown,
} from "../DockerError";
import type { CopyAtom, DockerSpec, RunnerSpec, UserAtom } from "../spec";
import type { ImageRef, PackageManager, NodeModulesLayout } from "../services/PackageManager";
import { bun as bunPm } from "../services/pm/bun";
import { npm as npmPm } from "../services/pm/npm";
import { pnpm as pnpmPm } from "../services/pm/pnpm";
import type { Runtime } from "../services/Runtime";
import { bun as bunRuntime } from "../services/runtime/bun";
import { node as nodeRuntime } from "../services/runtime/node";
import {
	allWorkspaces,
	closureOf,
	type DetectedPm,
	detectPm,
	findRoot,
	type RootDir,
	type Workspace,
} from "../services/WorkspaceGraph";
import type { Dockerfile, DockerfileBundle, Instruction, Stage } from "./DockerfileIR";

/* ──────────────────────────── context ──────────────────────────── */

export interface LowerContext {
	readonly root: RootDir;
	readonly allWorkspaces: ReadonlyArray<Workspace>;
	readonly closure: ReadonlyArray<Workspace>;
	readonly target: Workspace;
	readonly detectedPm: DetectedPm;
	readonly hasPatchesDir: boolean;
}

const lookupTarget = (
	all: ReadonlyArray<Workspace>,
	ref: string,
	root: string,
): Workspace | undefined => {
	const byNameOrRel = all.find((w) => w.name === ref || w.relDir === ref);
	if (byNameOrRel) return byNameOrRel;
	if (ref.startsWith(root)) {
		const rel = ref.slice(root.length).replace(/^[/\\]+/, "");
		return all.find((w) => w.relDir === rel);
	}
	return undefined;
};

export const prepareContext = (
	spec: DockerSpec,
): Effect.Effect<LowerContext, AnyDockerError, FileSystem | Path> =>
	Effect.gen(function* () {
		const fs = yield* FileSystem;
		const p = yield* Path;
		const root = yield* findRoot(spec.target);
		const all = yield* allWorkspaces(root);
		const target = lookupTarget(all, spec.target, root);
		if (!target) return yield* Effect.fail(new WorkspaceNotFound({ target: spec.target }));
		const detectedPm = yield* detectPm(root);
		const closure = yield* closureOf({ all, target: target.name });
		const hasPatchesDir = yield* fs
			.exists(p.join(root, "patches"))
			.pipe(Effect.orElseSucceed(() => false));
		return { root, allWorkspaces: all, closure, target, detectedPm, hasPatchesDir };
	});

/* ──────────────────────────── resolution ──────────────────────────── */

type PmKind = "Bun" | "Npm" | "Pnpm";
type RuntimeKind = "Bun" | "Node";

const specPmKind = (s: DockerSpec): PmKind | undefined => {
	switch (s.packageManager?._tag) {
		case "BunPm":
			return "Bun";
		case "NpmPm":
			return "Npm";
		case "PnpmPm":
			return "Pnpm";
		default:
			return undefined;
	}
};

const specRuntimeKind = (s: DockerSpec): RuntimeKind | undefined => {
	switch (s.runtime?._tag) {
		case "BunRuntime":
			return "Bun";
		case "NodeRuntime":
			return "Node";
		default:
			return undefined;
	}
};

const defaultRuntimeFor = (pm: PmKind): RuntimeKind => (pm === "Bun" ? "Bun" : "Node");

const pmImpl = (kind: PmKind, layout: NodeModulesLayout): PackageManager => {
	if (kind === "Bun") return bunPm;
	if (kind === "Npm") return npmPm;
	return pnpmPm({ layout });
};

const runtimeImpl = (kind: RuntimeKind): Runtime => (kind === "Bun" ? bunRuntime : nodeRuntime);

const pmEngineKey = (kind: PmKind): string => kind.toLowerCase();
const runtimeEngineKey = (kind: RuntimeKind): string => kind.toLowerCase();

const readEngineVersion = (ws: Workspace, key: string): string | undefined =>
	ws.pkg.engines?.[key];

/* ──────────────────────────── validation ──────────────────────────── */

export const validateSpec = (
	spec: DockerSpec,
	ctx: LowerContext,
): Effect.Effect<void, AnyDockerError, FileSystem | Path> =>
	Effect.gen(function* () {
		const fs = yield* FileSystem;
		const p = yield* Path;

		const closureNames = new Set<string>(ctx.closure.map((w) => w.name));
		for (const c of spec.runner.copy) {
			if (c._tag === "WorkspaceSource" && !closureNames.has(c.name)) {
				return yield* Effect.fail(
					new WorkspaceSourceUnknown({ target: ctx.target.name, missingWorkspace: c.name }),
				);
			}
		}

		if (spec.build?._tag === "BuildScript") {
			const script = spec.build.script;
			if (!ctx.target.pkg.scripts?.[script]) {
				return yield* Effect.fail(
					new BuildScriptMissing({ target: ctx.target.name, script }),
				);
			}
		}

		for (const path of spec.sharedRootFiles ?? []) {
			const ok = yield* fs
				.exists(p.join(ctx.root, path))
				.pipe(Effect.orElseSucceed(() => false));
			if (!ok) {
				return yield* Effect.fail(
					new SharedRootFileMissing({ target: ctx.target.name, path }),
				);
			}
		}
	});

/* ──────────────────────────── stage building ──────────────────────────── */

const HARDENED_DEFAULT_USER = { uid: 1001, gid: 1001, name: "app" } as const;

const envToInstruction = (env: Record<string, string> | undefined): Instruction | undefined => {
	if (!env) return undefined;
	const entries = Object.entries(env).sort(([a], [b]) => a.localeCompare(b));
	if (entries.length === 0) return undefined;
	return { _tag: "Env", entries };
};

const exposeToInstructions = (
	expose: number | ReadonlyArray<number> | undefined,
): ReadonlyArray<Instruction> => {
	if (expose === undefined) return [];
	const ports = typeof expose === "number" ? [expose] : expose;
	return ports.map((port): Instruction => ({ _tag: "Expose", port }));
};

const expandWorkspaceSourceAll = (
	copy: ReadonlyArray<CopyAtom>,
	closure: ReadonlyArray<Workspace>,
	target: Workspace,
): ReadonlyArray<CopyAtom> => {
	const out: CopyAtom[] = [];
	for (const c of copy) {
		if (c._tag === "WorkspaceSourceAll") {
			for (const w of closure) {
				if (w.name === target.name) continue;
				out.push({ _tag: "WorkspaceSource", name: w.name });
			}
		} else {
			out.push(c);
		}
	}
	return out;
};

const copyAtomToInstruction = (
	c: CopyAtom,
	ctx: LowerContext,
): Instruction | undefined => {
	const tgt = ctx.target;
	if (c._tag === "WorkspaceSourceAll") return undefined; // expanded earlier
	if (c._tag === "BuilderArtifact") {
		return {
			_tag: "Copy",
			from: "builder",
			src: [`/app/${tgt.relDir}/${c.src}`],
			dst: `/app/${tgt.relDir}/${c.dst}`,
			...(c.chown ? { chown: c.chown } : {}),
		};
	}
	if (c._tag === "WorkspaceSource") {
		const ws = ctx.closure.find((w) => w.name === c.name);
		if (!ws) return undefined;
		return {
			_tag: "Copy",
			from: "builder",
			src: [`/app/${ws.relDir}`],
			dst: `/app/${ws.relDir}`,
		};
	}
	if (c._tag === "CopyPath") {
		return {
			_tag: "Copy",
			...(c.from ? { from: c.from } : {}),
			src: [c.src],
			dst: c.dst,
			...(c.chown ? { chown: c.chown } : {}),
		};
	}
	return undefined;
};

const userInstructions = (user: UserAtom | undefined): {
	readonly setupRun: Instruction | undefined;
	readonly user: Instruction | undefined;
	readonly chown: string | undefined;
} => {
	const effective: UserAtom = user ?? { _tag: "UserNonRoot" };
	if (effective._tag === "UserRoot") return { setupRun: undefined, user: undefined, chown: undefined };
	const uid = effective.uid ?? HARDENED_DEFAULT_USER.uid;
	const gid = effective.gid ?? HARDENED_DEFAULT_USER.gid;
	const name = effective.name ?? HARDENED_DEFAULT_USER.name;
	const setupRun: Instruction = {
		_tag: "Run",
		cmd: `addgroup -S -g ${gid} ${name} && adduser -S -u ${uid} -G ${name} ${name}`,
	};
	return { setupRun, user: { _tag: "User", user: name }, chown: `${name}:${name}` };
};

interface PmContext {
	readonly pmKind: PmKind;
	readonly runtimeKind: RuntimeKind;
	readonly pmVersion: string;
	readonly runtimeVersion: string;
	readonly pmImpl: PackageManager;
	readonly runtimeImpl: Runtime;
	readonly runtimeImage: ImageRef;
	readonly depsImage: ImageRef;
	readonly alpine: boolean;
}

const resolveDefaults = (
	spec: DockerSpec,
	ctx: LowerContext,
): Effect.Effect<PmContext, AnyDockerError> =>
	Effect.gen(function* () {
		const pmKind: PmKind = specPmKind(spec) ?? ctx.detectedPm.kind;
		const runtimeKind: RuntimeKind = specRuntimeKind(spec) ?? defaultRuntimeFor(pmKind);
		const alpine =
			spec.runtime?._tag === "BunRuntime" || spec.runtime?._tag === "NodeRuntime"
				? spec.runtime.alpine ?? true
				: true;
		const pmVersion = readEngineVersion(ctx.target, pmEngineKey(pmKind));
		if (!pmVersion) {
			return yield* Effect.fail(
				new EngineVersionMissing({
					target: ctx.target.name,
					engineField: `engines.${pmEngineKey(pmKind)}`,
				}),
			);
		}
		const runtimeVersion = readEngineVersion(ctx.target, runtimeEngineKey(runtimeKind));
		if (!runtimeVersion) {
			return yield* Effect.fail(
				new EngineVersionMissing({
					target: ctx.target.name,
					engineField: `engines.${runtimeEngineKey(runtimeKind)}`,
				}),
			);
		}
		const pm = pmImpl(pmKind, ctx.detectedPm.pnpmLayout ?? "isolated");
		const runtime = runtimeImpl(runtimeKind);
		const runtimeImage = runtime.imageRef({ version: runtimeVersion, alpine });
		const depsImage = pm.depsImage({ runtimeImage, pmVersion });
		return {
			pmKind,
			runtimeKind,
			pmVersion,
			runtimeVersion,
			pmImpl: pm,
			runtimeImpl: runtime,
			runtimeImage,
			depsImage,
			alpine,
		};
	});

/* ──────────────────────────── prod stages ──────────────────────────── */

const baseStage = (img: ImageRef): Stage => ({
	name: "base",
	from: { _tag: "FromImage", image: img.image, tag: img.tag },
	instructions: [],
});

const depsStage = (ctx: LowerContext, pm: PmContext): Stage => {
	const rootFiles: ReadonlyArray<string> = [
		"package.json",
		...pm.pmImpl.lockfileNames,
		...pm.pmImpl.auxFiles,
	];
	const instructions: Instruction[] = [
		{ _tag: "Copy", src: rootFiles, dst: "./" },
	];
	if (ctx.hasPatchesDir) {
		instructions.push({ _tag: "Copy", src: ["patches"], dst: "./patches" });
	}
	for (const ws of ctx.allWorkspaces) {
		instructions.push({
			_tag: "Copy",
			src: [`${ws.relDir}/package.json`],
			dst: `./${ws.relDir}/`,
		});
	}
	for (const r of pm.pmImpl.prependDepsRuns(pm.pmVersion)) {
		instructions.push({ _tag: "Run", cmd: r });
	}
	instructions.push({ _tag: "Run", cmd: pm.pmImpl.installCommand.join(" ") });
	return {
		name: "deps",
		from: { _tag: "FromStage", stage: "base" },
		workdir: "/app",
		instructions,
	};
};

const builderStage = (
	spec: DockerSpec,
	ctx: LowerContext,
	pm: PmContext,
): Stage => {
	const instructions: Instruction[] = [];
	for (const path of spec.sharedRootFiles ?? []) {
		instructions.push({ _tag: "Copy", src: [path], dst: `./${path}` });
	}
	if (pm.pmImpl.nodeModulesLayout === "hoisted") {
		instructions.push({
			_tag: "Copy",
			from: "deps",
			src: ["/app/node_modules"],
			dst: "/app/node_modules",
		});
	} else {
		instructions.push({
			_tag: "Copy",
			from: "deps",
			src: ["/app/node_modules"],
			dst: "/app/node_modules",
		});
		for (const ws of ctx.closure) {
			instructions.push({
				_tag: "Copy",
				from: "deps",
				src: [`/app/${ws.relDir}/node_modules`],
				dst: `/app/${ws.relDir}/node_modules`,
			});
		}
	}
	for (const ws of ctx.closure) {
		instructions.push({ _tag: "Copy", src: [ws.relDir], dst: `./${ws.relDir}` });
	}
	instructions.push({ _tag: "Workdir", path: `/app/${ctx.target.relDir}` });
	const build = spec.build ?? (ctx.target.hasBuildScript
		? ({ _tag: "BuildScript", script: "build" } as const)
		: ({ _tag: "BuildNone" } as const));
	if (build._tag === "BuildScript") {
		instructions.push({ _tag: "Run", cmd: `${pm.pmKind.toLowerCase()} run ${build.script}` });
	} else if (build._tag === "BuildCommand") {
		instructions.push({ _tag: "Run", cmd: build.argv.join(" ") });
	}
	return {
		name: "builder",
		from: { _tag: "FromStage", stage: "base" },
		workdir: "/app",
		instructions,
	};
};

const platformAtomToIR = (
	p: DockerSpec["runner"]["platform"],
): Stage["platform"] => {
	if (!p) return undefined;
	switch (p._tag) {
		case "PlatformLinuxAmd64":
			return { _tag: "Single", value: "linux/amd64" };
		case "PlatformLinuxArm64":
			return { _tag: "Single", value: "linux/arm64" };
		case "PlatformMulti":
			return { _tag: "Multi", values: p.values };
	}
};

const runnerStage = (
	spec: DockerSpec,
	ctx: LowerContext,
	_pm: PmContext,
): Stage => {
	const runner: RunnerSpec = spec.runner;
	const user = userInstructions(runner.user);
	const instructions: Instruction[] = [];
	if (user.setupRun) instructions.push(user.setupRun);
	const env = { ...(runner.env ?? {}) };
	if (env["NODE_ENV"] === undefined) env["NODE_ENV"] = "production";
	const envInstr = envToInstruction(env);
	if (envInstr) instructions.push(envInstr);
	instructions.push(...exposeToInstructions(runner.expose));
	const expandedCopy = expandWorkspaceSourceAll(runner.copy, ctx.closure, ctx.target);
	// When the runner pulls in any workspace source, also pull in the root
	// node_modules so workspace:* symlinks (and bun's "bun"/"source" export
	// condition) resolve at runtime.
	const usesWorkspaceSource = expandedCopy.some((c) => c._tag === "WorkspaceSource");
	if (usesWorkspaceSource) {
		const chown = user.chown ? { chown: user.chown } : {};
		instructions.push({
			_tag: "Copy",
			from: "builder",
			src: ["/app/node_modules"],
			dst: "/app/node_modules",
			...chown,
		});
	}
	for (const c of expandedCopy) {
		let instr = copyAtomToInstruction(c, ctx);
		if (!instr) continue;
		if (instr._tag === "Copy" && !instr.chown && user.chown) {
			instr = { ...instr, chown: user.chown };
		}
		instructions.push(instr);
	}
	if (runner.healthcheck) {
		if (runner.healthcheck._tag === "HealthcheckHttpGet") {
			const hc = runner.healthcheck;
			instructions.push({
				_tag: "Healthcheck",
				check: {
					_tag: "Cmd",
					argv: ["wget", "--spider", "-q", `http://localhost:${hc.port}${hc.path}`],
					...(hc.interval ? { interval: hc.interval } : {}),
					...(hc.timeout ? { timeout: hc.timeout } : {}),
					...(hc.retries !== undefined ? { retries: hc.retries } : {}),
					...(hc.startPeriod ? { startPeriod: hc.startPeriod } : {}),
				},
			});
		} else {
			const hc = runner.healthcheck;
			instructions.push({
				_tag: "Healthcheck",
				check: {
					_tag: "Cmd",
					argv: hc.argv,
					...(hc.interval ? { interval: hc.interval } : {}),
					...(hc.timeout ? { timeout: hc.timeout } : {}),
					...(hc.retries !== undefined ? { retries: hc.retries } : {}),
					...(hc.startPeriod ? { startPeriod: hc.startPeriod } : {}),
				},
			});
		}
	}
	if (runner.entrypoint) instructions.push({ _tag: "Entrypoint", argv: runner.entrypoint });
	if (user.user) instructions.push(user.user);
	instructions.push({ _tag: "Cmd", argv: runner.cmd });
	return {
		name: "runner",
		from: { _tag: "FromStage", stage: "base" },
		...(platformAtomToIR(runner.platform) ? { platform: platformAtomToIR(runner.platform) } : {}),
		workdir: runner.workdir,
		instructions,
	};
};

/* ──────────────────────────── dev stage ──────────────────────────── */

const devStage = (spec: DockerSpec, ctx: LowerContext, pm: PmContext): Stage => {
	const dev = spec.dev;
	if (!dev) throw new Error("devStage called without spec.dev");
	const rootFiles: ReadonlyArray<string> = [
		"package.json",
		...pm.pmImpl.lockfileNames,
		...pm.pmImpl.auxFiles,
	];
	const instructions: Instruction[] = [
		{ _tag: "Copy", src: rootFiles, dst: "./" },
	];
	if (ctx.hasPatchesDir) {
		instructions.push({ _tag: "Copy", src: ["patches"], dst: "./patches" });
	}
	for (const ws of ctx.allWorkspaces) {
		instructions.push({
			_tag: "Copy",
			src: [`${ws.relDir}/package.json`],
			dst: `./${ws.relDir}/`,
		});
	}
	for (const r of pm.pmImpl.prependDepsRuns(pm.pmVersion)) {
		instructions.push({ _tag: "Run", cmd: r });
	}
	// dev installs scripts (no --ignore-scripts) so binaries are usable
	const devInstall = pm.pmImpl.installCommand.filter((s) => s !== "--ignore-scripts");
	instructions.push({ _tag: "Run", cmd: devInstall.join(" ") });
	for (const ws of ctx.closure) {
		instructions.push({ _tag: "Copy", src: [ws.relDir], dst: `./${ws.relDir}` });
	}
	instructions.push({ _tag: "Workdir", path: dev.workdir ?? `/app/${ctx.target.relDir}` });
	const env = { ...(dev.env ?? {}) };
	if (env["NODE_ENV"] === undefined) env["NODE_ENV"] = "development";
	const envInstr = envToInstruction(env);
	if (envInstr) instructions.push(envInstr);
	instructions.push(...exposeToInstructions(dev.expose));
	instructions.push({ _tag: "Cmd", argv: dev.cmd });
	return {
		name: "dev",
		from: { _tag: "FromStage", stage: "base" },
		workdir: "/app",
		instructions,
	};
};

/* ──────────────────────────── buildIR (pure) ──────────────────────────── */

export interface BuildIRInput {
	readonly spec: DockerSpec;
	readonly ctx: LowerContext;
	readonly pm: PmContext;
}

export const buildIR = (input: BuildIRInput): DockerfileBundle => {
	const { spec, ctx, pm } = input;
	const base = baseStage(pm.runtimeImage);
	const prod: Dockerfile = {
		args: [],
		stages: [base, depsStage(ctx, pm), builderStage(spec, ctx, pm), runnerStage(spec, ctx, pm)],
	};
	if (!spec.dev) return { prod };
	const dev: Dockerfile = { args: [], stages: [base, devStage(spec, ctx, pm)] };
	return { prod, dev };
};

/* ──────────────────────────── public lower ──────────────────────────── */

export const lower = (
	spec: DockerSpec,
): Effect.Effect<DockerfileBundle, AnyDockerError, FileSystem | Path> =>
	Effect.gen(function* () {
		const ctx = yield* prepareContext(spec);
		yield* validateSpec(spec, ctx);
		const pm = yield* resolveDefaults(spec, ctx);
		return buildIR({ spec, ctx, pm });
	});
