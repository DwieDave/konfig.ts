import { Effect, Predicate } from "effect"
import { isParsedDoc, isRawYaml } from "./Manifest"
import type { YamlParseError } from "./RenderError"
import { unwrapDocs } from "./unwrapDocs"

const _isWrapper = <A>(value: A): boolean => isRawYaml(value) || isParsedDoc(value)

export const flattenDocs = <A>(value: A): Effect.Effect<ReadonlyArray<unknown>, YamlParseError> =>
  Array.isArray(value)
    ? Effect.forEach(value, flattenDocs).pipe(Effect.map((groups) => groups.flat()))
    : _isWrapper(value)
    ? unwrapDocs(value).pipe(Effect.flatMap(flattenDocs))
    : Effect.succeed(Predicate.isNotNullish(value) ? [value] : [])
