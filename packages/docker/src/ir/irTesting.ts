import { Data } from "effect"
import type { DockerfileBundle, From, HealthcheckIR, Instruction, Stage } from "./DockerfileIR"

export const Instr = Data.taggedEnum<Instruction>()

export const FromOf = Data.taggedEnum<From>()

export const HealthOf = Data.taggedEnum<HealthcheckIR>()

export const stageOf = (name: string) => (bundle: DockerfileBundle): Stage | undefined =>
  bundle.prod.stages.find((s) => s.name === name)

export const copiesOf = (stage: Stage | undefined) => (stage?.instructions ?? []).filter(Instr.$is("Copy"))

export const runsOf = (stage: Stage | undefined) => (stage?.instructions ?? []).filter(Instr.$is("Run"))

export const envOf = (stage: Stage | undefined) => (stage?.instructions ?? []).find(Instr.$is("Env"))

class MissingValue extends Data.TaggedError("MissingValue")<{ readonly what: string }> {}

export const requireDefined = <A>(input: { readonly value: A | undefined; readonly what: string }): A => {
  if (input.value === undefined) throw new MissingValue({ what: input.what })

  return input.value
}

export const requireStage = (input: { readonly bundle: DockerfileBundle; readonly name: string }): Stage =>
  requireDefined({ value: stageOf(input.name)(input.bundle), what: `stage ${input.name}` })
