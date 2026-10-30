import { Data } from "effect"
import type { From, HealthcheckIR, Instruction, PlatformIR } from "../ir/DockerfileIR"

export const InstructionTag = Data.taggedEnum<Instruction>()

export const FromTag = Data.taggedEnum<From>()

export const PlatformTag = Data.taggedEnum<PlatformIR>()

export const HealthcheckTag = Data.taggedEnum<HealthcheckIR>()
