import type {
	BuildAtom,
	CopyAtom,
	DockerSpec,
	HealthcheckAtom,
	PackageManagerAtom,
	PlatformAtom,
	RuntimeAtom,
	UserAtom,
} from "./spec";

export const DockerAppTypeId: unique symbol = Symbol.for("@konfig.ts/docker/DockerApp");
export type DockerAppTypeId = typeof DockerAppTypeId;

interface Variance {
	readonly _A: (_: never) => never;
}

const variance: Variance = { _A: (_: never) => _ };

export interface DockerApp {
	readonly [DockerAppTypeId]: Variance;
	readonly spec: DockerSpec;
}

export const makeDockerApp = (spec: DockerSpec): DockerApp => ({
	[DockerAppTypeId]: variance,
	spec,
});

export const isDockerApp = (u: unknown): u is DockerApp =>
	typeof u === "object" && u !== null && DockerAppTypeId in u;

const omitUndef = <T extends Record<string, unknown>>(o: T): T => {
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(o)) {
		if (v !== undefined) out[k] = v;
	}
	return out as T;
};

export const Docker = {
	app: (spec: DockerSpec): DockerApp => makeDockerApp(spec),
	pm: {
		bun: (): PackageManagerAtom => ({ _tag: "BunPm" }),
		npm: (): PackageManagerAtom => ({ _tag: "NpmPm" }),
		pnpm: (): PackageManagerAtom => ({ _tag: "PnpmPm" }),
	},
	runtime: {
		bun: (opts?: { alpine?: boolean }): RuntimeAtom =>
			omitUndef({ _tag: "BunRuntime", alpine: opts?.alpine }) as RuntimeAtom,
		node: (opts?: { alpine?: boolean }): RuntimeAtom =>
			omitUndef({ _tag: "NodeRuntime", alpine: opts?.alpine }) as RuntimeAtom,
	},
	build: {
		script: (script: string): BuildAtom => ({ _tag: "BuildScript", script }),
		command: (argv: ReadonlyArray<string>): BuildAtom => ({ _tag: "BuildCommand", argv }),
		none: (): BuildAtom => ({ _tag: "BuildNone" }),
	},
	copy: {
		builderArtifact: (src: string, dst: string, opts?: { chown?: string }): CopyAtom =>
			omitUndef({ _tag: "BuilderArtifact", src, dst, chown: opts?.chown }) as CopyAtom,
		workspaceSource: (name: string): CopyAtom => ({ _tag: "WorkspaceSource", name }),
		workspaceSourceAll: (): CopyAtom => ({ _tag: "WorkspaceSourceAll" }),
		path: (
			src: string,
			dst: string,
			opts?: { from?: string; chown?: string },
		): CopyAtom =>
			omitUndef({ _tag: "CopyPath", src, dst, from: opts?.from, chown: opts?.chown }) as CopyAtom,
	},
	healthcheck: {
		httpGet: (input: {
			path: string;
			port: number;
			interval?: string;
			timeout?: string;
			retries?: number;
			startPeriod?: string;
		}): HealthcheckAtom => omitUndef({ _tag: "HealthcheckHttpGet", ...input }) as HealthcheckAtom,
		command: (
			argv: ReadonlyArray<string>,
			opts?: {
				interval?: string;
				timeout?: string;
				retries?: number;
				startPeriod?: string;
			},
		): HealthcheckAtom =>
			omitUndef({ _tag: "HealthcheckCommand", argv, ...(opts ?? {}) }) as HealthcheckAtom,
	},
	user: {
		nonRoot: (opts?: { uid?: number; gid?: number; name?: string }): UserAtom =>
			omitUndef({ _tag: "UserNonRoot", ...(opts ?? {}) }) as UserAtom,
		root: (): UserAtom => ({ _tag: "UserRoot" }),
	},
	platform: {
		linuxAmd64: (): PlatformAtom => ({ _tag: "PlatformLinuxAmd64" }),
		linuxArm64: (): PlatformAtom => ({ _tag: "PlatformLinuxArm64" }),
		multi: (values: ReadonlyArray<"linux/amd64" | "linux/arm64">): PlatformAtom => ({
			_tag: "PlatformMulti",
			values,
		}),
	},
} as const;
