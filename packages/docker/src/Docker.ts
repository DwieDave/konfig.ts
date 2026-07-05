import { unsafeCoerce } from "@konfig.ts/core"
import type {
  BuildAtom,
  CopyAtom,
  DockerSpec,
  HealthcheckAtom,
  PackageManagerAtom,
  PlatformAtom,
  RuntimeAtom,
  UserAtom
} from "./spec"

export const DockerAppTypeId: unique symbol = Symbol.for("@konfig.ts/docker/DockerApp")
export type DockerAppTypeId = typeof DockerAppTypeId

interface Variance {
  readonly _A: (_: never) => never
}

const variance: Variance = { _A: (_: never) => _ }

export interface DockerApp {
  readonly [DockerAppTypeId]: Variance
  readonly spec: DockerSpec
}

export const makeDockerApp = (spec: DockerSpec): DockerApp => ({
  [DockerAppTypeId]: variance,
  spec
})

export const isDockerApp = (u: unknown): u is DockerApp => typeof u === "object" && u !== null && DockerAppTypeId in u

const _omitUndef = <T extends Record<string, unknown>>(o: T): T => {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(o)) {
    if (v !== undefined) out[k] = v
  }
  return unsafeCoerce<T>(
    out,
    "out was built by copying defined entries of T; the resulting record is structurally T modulo optional-field absence"
  )
}

export const Docker = {
  app: (spec: DockerSpec): DockerApp => makeDockerApp(spec),
  pm: {
    bun: (): PackageManagerAtom => ({ _tag: "BunPm" }),
    npm: (): PackageManagerAtom => ({ _tag: "NpmPm" }),
    pnpm: (): PackageManagerAtom => ({ _tag: "PnpmPm" }),
    yarn: (opts?: { variant?: "classic" | "berry" }): PackageManagerAtom =>
      unsafeCoerce<PackageManagerAtom>(
        _omitUndef({ _tag: "YarnPm", variant: opts?.variant }),
        "_omitUndef preserves the literal _tag; structurally a PackageManagerAtom variant"
      )
  },
  runtime: {
    bun: (opts?: { alpine?: boolean }): RuntimeAtom =>
      unsafeCoerce<RuntimeAtom>(
        _omitUndef({ _tag: "BunRuntime", alpine: opts?.alpine }),
        "_omitUndef preserves the literal _tag; structurally a RuntimeAtom variant"
      ),
    node: (opts?: { alpine?: boolean }): RuntimeAtom =>
      unsafeCoerce<RuntimeAtom>(
        _omitUndef({ _tag: "NodeRuntime", alpine: opts?.alpine }),
        "_omitUndef preserves the literal _tag; structurally a RuntimeAtom variant"
      )
  },
  build: {
    script: (script: string): BuildAtom => ({ _tag: "BuildScript", script }),
    command: (argv: ReadonlyArray<string>): BuildAtom => ({ _tag: "BuildCommand", argv }),
    none: (): BuildAtom => ({ _tag: "BuildNone" })
  },
  copy: {
    builderArtifact: (input: { readonly src: string; readonly dst: string; readonly chown?: string }): CopyAtom =>
      unsafeCoerce<CopyAtom>(
        _omitUndef({ _tag: "BuilderArtifact", src: input.src, dst: input.dst, chown: input.chown }),
        "_omitUndef preserves the literal _tag; structurally a CopyAtom variant"
      ),
    workspaceSource: (name: string): CopyAtom => ({ _tag: "WorkspaceSource", name }),
    workspaceSourceAll: (): CopyAtom => ({ _tag: "WorkspaceSourceAll" }),
    path: (input: {
      readonly src: string
      readonly dst: string
      readonly from?: string
      readonly chown?: string
    }): CopyAtom =>
      unsafeCoerce<CopyAtom>(
        _omitUndef({ _tag: "CopyPath", src: input.src, dst: input.dst, from: input.from, chown: input.chown }),
        "_omitUndef preserves the literal _tag; structurally a CopyAtom variant"
      )
  },
  healthcheck: {
    httpGet: (input: {
      path: string
      port: number
      interval?: string
      timeout?: string
      retries?: number
      startPeriod?: string
    }): HealthcheckAtom =>
      unsafeCoerce<HealthcheckAtom>(
        _omitUndef({ _tag: "HealthcheckHttpGet", ...input }),
        "_omitUndef preserves the literal _tag; structurally a HealthcheckAtom variant"
      ),
    command: (input: {
      readonly argv: ReadonlyArray<string>
      readonly interval?: string
      readonly timeout?: string
      readonly retries?: number
      readonly startPeriod?: string
    }): HealthcheckAtom =>
      unsafeCoerce<HealthcheckAtom>(
        _omitUndef({ _tag: "HealthcheckCommand", ...input }),
        "_omitUndef preserves the literal _tag; structurally a HealthcheckAtom variant"
      )
  },
  user: {
    nonRoot: (opts?: { uid?: number; gid?: number; name?: string }): UserAtom =>
      unsafeCoerce<UserAtom>(
        _omitUndef({ _tag: "UserNonRoot", ...opts }),
        "_omitUndef preserves the literal _tag; structurally a UserAtom variant"
      ),
    root: (): UserAtom => ({ _tag: "UserRoot" })
  },
  platform: {
    linuxAmd64: (): PlatformAtom => ({ _tag: "PlatformLinuxAmd64" }),
    linuxArm64: (): PlatformAtom => ({ _tag: "PlatformLinuxArm64" }),
    multi: (values: ReadonlyArray<"linux/amd64" | "linux/arm64">): PlatformAtom => ({
      _tag: "PlatformMulti",
      values
    })
  }
} as const
