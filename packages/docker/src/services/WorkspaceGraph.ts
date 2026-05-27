import { Effect } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import { parse as parseYaml } from "yaml";
import {
	CircularWorkspaceDep,
	MonorepoRootNotFound,
	UnsupportedPm,
	WorkspaceNotFound,
} from "../DockerError";
import type { NodeModulesLayout } from "./PackageManager";

const ROOT_BRAND: unique symbol = Symbol.for("@konfig.ts/docker/RootDir");
export type RootDir = string & { readonly [ROOT_BRAND]: true };

const brandRoot = (s: string): RootDir => s as RootDir;

export interface PackageJson {
	readonly name?: string;
	readonly version?: string;
	readonly workspaces?: ReadonlyArray<string> | { packages?: ReadonlyArray<string> };
	readonly dependencies?: Record<string, string>;
	readonly devDependencies?: Record<string, string>;
	readonly peerDependencies?: Record<string, string>;
	readonly scripts?: Record<string, string>;
	readonly packageManager?: string;
	readonly engines?: Record<string, string>;
}

export interface Workspace {
	readonly name: string;
	readonly relDir: string;
	readonly pkg: PackageJson;
	readonly hasBuildScript: boolean;
}

export interface DetectedPm {
	readonly kind: "Bun" | "Npm" | "Pnpm";
	readonly version: string | undefined;
	readonly pnpmLayout?: NodeModulesLayout;
}

/* ──────────────────────────── findRoot ──────────────────────────── */

const readPkgJsonIfExists = (
	fs: FileSystem,
	p: Path,
	cur: string,
): Effect.Effect<PackageJson | undefined, never> =>
	Effect.gen(function* () {
		const pkgPath = p.join(cur, "package.json");
		const exists = yield* fs.exists(pkgPath).pipe(Effect.orElseSucceed(() => false));
		if (!exists) return undefined;
		const text = yield* fs.readFileString(pkgPath).pipe(Effect.orElseSucceed(() => ""));
		if (text === "") return undefined;
		try {
			return JSON.parse(text) as PackageJson;
		} catch {
			return undefined;
		}
	});

const isMonorepoRoot = (pkg: PackageJson | undefined, hasPnpmYaml: boolean): boolean => {
	if (hasPnpmYaml) return true;
	if (!pkg?.workspaces) return false;
	return true;
};

export const findRoot = (from: string): Effect.Effect<RootDir, MonorepoRootNotFound, FileSystem | Path> =>
	Effect.gen(function* () {
		const fs = yield* FileSystem;
		const p = yield* Path;
		let cur = p.resolve(from);
		// Walk up to filesystem root; bail when dirname is a fixed point.
		// Bound by 64 iterations as a defense against pathological symlinks.
		for (let i = 0; i < 64; i++) {
			const pkg = yield* readPkgJsonIfExists(fs, p, cur);
			const pnpmYamlExists = yield* fs
				.exists(p.join(cur, "pnpm-workspace.yaml"))
				.pipe(Effect.orElseSucceed(() => false));
			if (isMonorepoRoot(pkg, pnpmYamlExists)) return brandRoot(cur);
			const parent = p.dirname(cur);
			if (parent === cur) break;
			cur = parent;
		}
		return yield* Effect.fail(new MonorepoRootNotFound({ from }));
	});

/* ──────────────────────────── glob ──────────────────────────── */

const expandWorkspaceGlob = (
	fs: FileSystem,
	p: Path,
	root: string,
	pattern: string,
): Effect.Effect<ReadonlyArray<string>, never> =>
	Effect.gen(function* () {
		const parts = pattern.split("/").filter((s) => s.length > 0);
		let currents: ReadonlyArray<string> = [""];
		for (const part of parts) {
			const next: string[] = [];
			for (const cur of currents) {
				const absDir = p.join(root, cur);
				if (part === "*") {
					const children = yield* fs
						.readDirectory(absDir)
						.pipe(Effect.orElseSucceed(() => [] as string[]));
					for (const ch of children) {
						const childAbs = p.join(absDir, ch);
						const childPkg = p.join(childAbs, "package.json");
						const exists = yield* fs.exists(childPkg).pipe(Effect.orElseSucceed(() => false));
						if (exists) next.push(p.join(cur, ch));
						else next.push(p.join(cur, ch));
					}
				} else if (part === "**") {
					return yield* Effect.fail(new Error("** glob not supported in workspaces patterns"));
				} else {
					next.push(p.join(cur, part));
				}
			}
			currents = next;
		}
		// Filter to ones with package.json
		const filtered: string[] = [];
		for (const c of currents) {
			const pkgPath = p.join(root, c, "package.json");
			const ex = yield* fs.exists(pkgPath).pipe(Effect.orElseSucceed(() => false));
			if (ex) filtered.push(c);
		}
		return filtered;
	}).pipe(Effect.orElseSucceed(() => []));

/* ──────────────────────────── allWorkspaces ──────────────────────────── */

const workspacePatterns = async (
	root: RootDir,
	fs: FileSystem,
	p: Path,
): Promise<ReadonlyArray<string>> => {
	// Unused; effectful version below.
	void root;
	void fs;
	void p;
	return [];
};

void workspacePatterns;

interface PnpmWorkspaceYaml {
	readonly packages?: ReadonlyArray<string>;
}

const readWorkspacePatterns = (
	root: RootDir,
	fs: FileSystem,
	p: Path,
): Effect.Effect<ReadonlyArray<string>, never> =>
	Effect.gen(function* () {
		const pnpmPath = p.join(root, "pnpm-workspace.yaml");
		const pnpmExists = yield* fs.exists(pnpmPath).pipe(Effect.orElseSucceed(() => false));
		if (pnpmExists) {
			const text = yield* fs.readFileString(pnpmPath).pipe(Effect.orElseSucceed(() => ""));
			if (text === "") return [];
			try {
				const parsed = parseYaml(text) as PnpmWorkspaceYaml;
				return parsed.packages ?? [];
			} catch {
				return [];
			}
		}
		const pkg = yield* readPkgJsonIfExists(fs, p, root);
		const ws = pkg?.workspaces;
		if (!ws) return [];
		if (Array.isArray(ws)) return ws;
		return (ws as { packages?: ReadonlyArray<string> }).packages ?? [];
	});

const parseWorkspacePackage = (
	root: RootDir,
	fs: FileSystem,
	p: Path,
	relDir: string,
): Effect.Effect<Workspace | undefined, never> =>
	Effect.gen(function* () {
		const pkgPath = p.join(root, relDir, "package.json");
		const text = yield* fs.readFileString(pkgPath).pipe(Effect.orElseSucceed(() => ""));
		if (text === "") return undefined;
		try {
			const pkg = JSON.parse(text) as PackageJson;
			if (!pkg.name) return undefined;
			return {
				name: pkg.name,
				relDir,
				pkg,
				hasBuildScript: Boolean(pkg.scripts?.build),
			};
		} catch {
			return undefined;
		}
	});

export const allWorkspaces = (
	root: RootDir,
): Effect.Effect<ReadonlyArray<Workspace>, never, FileSystem | Path> =>
	Effect.gen(function* () {
		const fs = yield* FileSystem;
		const p = yield* Path;
		const patterns = yield* readWorkspacePatterns(root, fs, p);
		const dirSet = new Set<string>();
		for (const pat of patterns) {
			const dirs = yield* expandWorkspaceGlob(fs, p, root, pat);
			for (const d of dirs) dirSet.add(d);
		}
		const out: Workspace[] = [];
		for (const d of dirSet) {
			const ws = yield* parseWorkspacePackage(root, fs, p, d);
			if (ws) out.push(ws);
		}
		out.sort((a, b) => a.name.localeCompare(b.name));
		return out;
	});

/* ──────────────────────────── detectPm ──────────────────────────── */

const parseCorepackField = (
	pm: string,
): { kind: "Bun" | "Npm" | "Pnpm"; version: string } | undefined => {
	const at = pm.lastIndexOf("@");
	if (at < 0) return undefined;
	const name = pm.slice(0, at);
	const version = pm.slice(at + 1).split("+")[0] ?? "";
	if (name === "bun") return { kind: "Bun", version };
	if (name === "npm") return { kind: "Npm", version };
	if (name === "pnpm") return { kind: "Pnpm", version };
	return undefined;
};

const PM_LOCKFILES: ReadonlyArray<{ kind: "Bun" | "Npm" | "Pnpm"; file: string }> = [
	{ kind: "Bun", file: "bun.lock" },
	{ kind: "Bun", file: "bun.lockb" },
	{ kind: "Pnpm", file: "pnpm-lock.yaml" },
	{ kind: "Npm", file: "package-lock.json" },
];

const detectPnpmLayout = (
	root: RootDir,
	fs: FileSystem,
	p: Path,
): Effect.Effect<NodeModulesLayout, never> =>
	Effect.gen(function* () {
		const npmrc = yield* fs
			.readFileString(p.join(root, ".npmrc"))
			.pipe(Effect.orElseSucceed(() => ""));
		if (/^\s*node-linker\s*=\s*hoisted\s*$/m.test(npmrc)) return "hoisted";
		const pnpmYaml = yield* fs
			.readFileString(p.join(root, "pnpm-workspace.yaml"))
			.pipe(Effect.orElseSucceed(() => ""));
		if (/^\s*nodeLinker:\s*hoisted\s*$/m.test(pnpmYaml)) return "hoisted";
		return "isolated";
	});

export const detectPm = (
	root: RootDir,
): Effect.Effect<DetectedPm, UnsupportedPm, FileSystem | Path> =>
	Effect.gen(function* () {
		const fs = yield* FileSystem;
		const p = yield* Path;
		const pkg = yield* readPkgJsonIfExists(fs, p, root);
		const corepack = pkg?.packageManager ? parseCorepackField(pkg.packageManager) : undefined;
		const presentLockfiles: Array<{ kind: "Bun" | "Npm" | "Pnpm"; file: string }> = [];
		for (const entry of PM_LOCKFILES) {
			const ex = yield* fs
				.exists(p.join(root, entry.file))
				.pipe(Effect.orElseSucceed(() => false));
			if (ex) presentLockfiles.push(entry);
		}
		// Corepack wins.
		if (corepack) {
			const layout = corepack.kind === "Pnpm" ? yield* detectPnpmLayout(root, fs, p) : undefined;
			return {
				kind: corepack.kind,
				version: corepack.version,
				...(layout ? { pnpmLayout: layout } : {}),
			};
		}
		const kinds = new Set(presentLockfiles.map((l) => l.kind));
		if (kinds.size === 0) {
			return yield* Effect.fail(
				new UnsupportedPm({
					reason: "no packageManager field and no recognized lockfile",
				}),
			);
		}
		if (kinds.size > 1) {
			return yield* Effect.fail(
				new UnsupportedPm({
					reason: "multiple lockfiles present and no packageManager field to disambiguate",
					candidates: [...kinds],
				}),
			);
		}
		const kind = [...kinds][0]!;
		const layout = kind === "Pnpm" ? yield* detectPnpmLayout(root, fs, p) : undefined;
		return { kind, version: undefined, ...(layout ? { pnpmLayout: layout } : {}) };
	});

/* ──────────────────────────── closureOf ──────────────────────────── */

const WORKSPACE_PROTOCOLS = ["workspace:", "link:"] as const;

const workspaceDeps = (pkg: PackageJson): ReadonlyArray<string> => {
	const out: string[] = [];
	const merge = (rec?: Record<string, string>): void => {
		if (!rec) return;
		for (const [name, spec] of Object.entries(rec)) {
			if (WORKSPACE_PROTOCOLS.some((p) => spec.startsWith(p))) out.push(name);
		}
	};
	// Closure follows runtime edges only. devDependencies are by definition
	// build-time only and must not leak into the runner stage's closure.
	merge(pkg.dependencies);
	merge(pkg.peerDependencies);
	return out;
};

export interface ClosureInput {
	readonly all: ReadonlyArray<Workspace>;
	readonly target: string;
}

export const closureOf = (
	input: ClosureInput,
): Effect.Effect<ReadonlyArray<Workspace>, WorkspaceNotFound | CircularWorkspaceDep> =>
	Effect.gen(function* () {
		const byName = new Map<string, Workspace>();
		const byRelDir = new Map<string, Workspace>();
		for (const ws of input.all) {
			byName.set(ws.name, ws);
			byRelDir.set(ws.relDir, ws);
		}
		const lookup = (ref: string): Workspace | undefined =>
			byName.get(ref) ?? byRelDir.get(ref);
		const root = lookup(input.target);
		if (!root) return yield* Effect.fail(new WorkspaceNotFound({ target: input.target }));
		const visited = new Set<string>();
		const onStack = new Set<string>();
		const order: Workspace[] = [];
		const cycleErr = (cycle: string[]): CircularWorkspaceDep =>
			new CircularWorkspaceDep({ cycle });
		const dfs = (ws: Workspace, stack: string[]): CircularWorkspaceDep | undefined => {
			if (visited.has(ws.name)) return undefined;
			if (onStack.has(ws.name)) return cycleErr([...stack, ws.name]);
			onStack.add(ws.name);
			const deps = workspaceDeps(ws.pkg);
			for (const depName of deps) {
				const dep = byName.get(depName);
				if (!dep) continue;
				const err = dfs(dep, [...stack, ws.name]);
				if (err) return err;
			}
			onStack.delete(ws.name);
			visited.add(ws.name);
			order.push(ws);
			return undefined;
		};
		const err = dfs(root, []);
		if (err) return yield* Effect.fail(err);
		return order;
	});
