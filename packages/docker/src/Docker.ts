import { isRecord, omitUndefined } from "@konfig.ts/core"
import type { YarnVariant } from "./services/PackageManager"
import { BuildAtom, CopyAtom, HealthcheckAtom, PackageManagerAtom, PlatformAtom, RuntimeAtom, UserAtom } from "./spec"
import type { DockerSpec } from "./spec"

export const DockerAppTypeId: unique symbol = Symbol.for("@konfig.ts/docker/DockerApp")

export type DockerAppTypeId = typeof DockerAppTypeId

export interface DockerApp {
  readonly [DockerAppTypeId]: true
  readonly spec: DockerSpec
}

export const makeDockerApp = (spec: DockerSpec): DockerApp => ({ [DockerAppTypeId]: true, spec })

export const isDockerApp = (u: unknown): u is DockerApp => isRecord(u) && DockerAppTypeId in u

export const Docker = {
  app: makeDockerApp,
  pm: {
    bun: (): PackageManagerAtom => PackageManagerAtom.cases.BunPm.make({}),
    npm: (): PackageManagerAtom => PackageManagerAtom.cases.NpmPm.make({}),
    pnpm: (): PackageManagerAtom => PackageManagerAtom.cases.PnpmPm.make({}),
    yarn: (opts?: { variant?: YarnVariant }): PackageManagerAtom =>
      PackageManagerAtom.cases.YarnPm.make(omitUndefined({ variant: opts?.variant }))
  },
  runtime: {
    bun: (opts?: { alpine?: boolean }): RuntimeAtom =>
      RuntimeAtom.cases.BunRuntime.make(omitUndefined({ alpine: opts?.alpine })),
    node: (opts?: { alpine?: boolean }): RuntimeAtom =>
      RuntimeAtom.cases.NodeRuntime.make(omitUndefined({ alpine: opts?.alpine }))
  },
  build: {
    script: (script: string): BuildAtom => BuildAtom.cases.BuildScript.make({ script }),
    command: (argv: ReadonlyArray<string>): BuildAtom => BuildAtom.cases.BuildCommand.make({ argv }),
    none: (): BuildAtom => BuildAtom.cases.BuildNone.make({})
  },
  copy: {
    builderArtifact: (input: { readonly src: string; readonly dst: string; readonly chown?: string }): CopyAtom =>
      CopyAtom.cases.BuilderArtifact.make({ src: input.src, dst: input.dst, ...omitUndefined({ chown: input.chown }) }),
    workspaceSource: (name: string): CopyAtom => CopyAtom.cases.WorkspaceSource.make({ name }),
    workspaceSourceAll: (): CopyAtom => CopyAtom.cases.WorkspaceSourceAll.make({}),
    path: (input: {
      readonly src: string
      readonly dst: string
      readonly from?: string
      readonly chown?: string
    }): CopyAtom =>
      CopyAtom.cases.CopyPath.make({
        src: input.src,
        dst: input.dst,
        ...omitUndefined({ from: input.from, chown: input.chown })
      })
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
      HealthcheckAtom.cases.HealthcheckHttpGet.make({
        path: input.path,
        port: input.port,
        ...omitUndefined({ ...input, path: undefined, port: undefined })
      }),
    command: (input: {
      readonly argv: ReadonlyArray<string>
      readonly interval?: string
      readonly timeout?: string
      readonly retries?: number
      readonly startPeriod?: string
    }): HealthcheckAtom =>
      HealthcheckAtom.cases.HealthcheckCommand.make({
        argv: input.argv,
        ...omitUndefined({ ...input, argv: undefined })
      })
  },
  user: {
    nonRoot: (opts?: { uid?: number; gid?: number; name?: string }): UserAtom =>
      UserAtom.cases.UserNonRoot.make(omitUndefined({ ...opts })),
    root: (): UserAtom => UserAtom.cases.UserRoot.make({})
  },
  platform: {
    linuxAmd64: (): PlatformAtom => PlatformAtom.cases.PlatformLinuxAmd64.make({}),
    linuxArm64: (): PlatformAtom => PlatformAtom.cases.PlatformLinuxArm64.make({})
  }
} as const
