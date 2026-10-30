import { RenderError } from "@konfig.ts/core"
import { Effect } from "effect"
import type { SopsSecret } from "./crd"

export type SopsMetadata = SopsSecret["sops"]

type PathPredicate = (path: readonly string[]) => boolean

export interface CompiledPolicy {
  readonly verdicts: readonly PathPredicate[]
}

const _compileRegex = (input: {
  readonly field: string
  readonly raw: string
  readonly label: string
}): Effect.Effect<RegExp, RenderError> =>
  Effect.try({
    try: () => new RegExp(input.raw),
    catch: (cause) =>
      new RenderError({
        message: `${input.label}: sops.${input.field} is not a valid regex`,
        cause
      })
  })

const _anySegment = (test: (segment: string) => boolean): PathPredicate => (path) => path.some(test)

const _negate = (predicate: PathPredicate): PathPredicate => (path) => !predicate(path)

const _regexVerdict = (input: {
  readonly field: "encrypted_regex" | "unencrypted_regex"
  readonly raw: string | undefined
  readonly label: string
}): Effect.Effect<readonly PathPredicate[], RenderError> => {
  const { raw } = input

  if (raw === undefined) return Effect.succeed([])

  return _compileRegex({ field: input.field, raw, label: input.label }).pipe(
    Effect.map((regex) => {
      const matches = _anySegment((segment) => regex.test(segment))

      return [input.field === "encrypted_regex" ? matches : _negate(matches)]
    })
  )
}

const _suffixVerdict = (input: {
  readonly suffix: string | undefined
  readonly encryptsMatches: boolean
}): readonly PathPredicate[] => {
  const { suffix } = input

  if (suffix === undefined) return []
  const matches = _anySegment((segment) => segment.endsWith(suffix))

  return [input.encryptsMatches ? matches : _negate(matches)]
}

export const compilePolicy = (input: {
  readonly sops: SopsMetadata
  readonly label: string
}): Effect.Effect<CompiledPolicy, RenderError> =>
  Effect.gen(function*() {
    const { sops, label } = input
    const encrypted = yield* _regexVerdict({ field: "encrypted_regex", raw: sops.encrypted_regex, label })
    const unencrypted = yield* _regexVerdict({ field: "unencrypted_regex", raw: sops.unencrypted_regex, label })

    return {
      verdicts: [
        ...encrypted,
        ...unencrypted,
        ..._suffixVerdict({ suffix: sops.encrypted_suffix, encryptsMatches: true }),
        ..._suffixVerdict({ suffix: sops.unencrypted_suffix, encryptsMatches: false })
      ]
    }
  })

export const mustEncrypt = (input: {
  readonly policy: CompiledPolicy
  readonly path: readonly string[]
}): boolean => input.policy.verdicts.length === 0 || input.policy.verdicts.some((verdict) => verdict(input.path))
