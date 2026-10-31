import { Data } from "effect"

export type DockerfileBundle = {
  readonly prod: Dockerfile
  readonly dev?: Dockerfile
}

export type Dockerfile = {
  readonly stages: ReadonlyArray<Stage>
}

export type Stage = {
  readonly name: string
  readonly from: From
  readonly platform?: PlatformIR
  readonly workdir?: string
  readonly instructions: ReadonlyArray<Instruction>
}

export type From =
  | { readonly _tag: "FromImage"; readonly image: string; readonly tag: string }
  | { readonly _tag: "FromStage"; readonly stage: string }

export type PlatformIR = { readonly _tag: "Single"; readonly value: PlatformValue }

export type PlatformValue = "linux/amd64" | "linux/arm64"

export type Instruction =
  | {
    readonly _tag: "Copy"
    readonly from?: string
    readonly src: ReadonlyArray<string>
    readonly dst: string
    readonly chown?: string
  }
  | { readonly _tag: "Run"; readonly cmd: string }
  | { readonly _tag: "Env"; readonly entries: ReadonlyArray<readonly [string, string]> }
  | { readonly _tag: "Expose"; readonly port: number }
  | { readonly _tag: "User"; readonly user: string }
  | { readonly _tag: "Workdir"; readonly path: string }
  | { readonly _tag: "Cmd"; readonly argv: ReadonlyArray<string> }
  | { readonly _tag: "Entrypoint"; readonly argv: ReadonlyArray<string> }
  | { readonly _tag: "Healthcheck"; readonly check: HealthcheckIR }

export type HealthcheckIR = {
  readonly _tag: "Cmd"
  readonly argv: ReadonlyArray<string>
  readonly interval?: string
  readonly timeout?: string
  readonly retries?: number
  readonly startPeriod?: string
}

export const Instr = Data.taggedEnum<Instruction>()

export const FromOf = Data.taggedEnum<From>()

export const HealthOf = Data.taggedEnum<HealthcheckIR>()

export const PlatformOf = Data.taggedEnum<PlatformIR>()
