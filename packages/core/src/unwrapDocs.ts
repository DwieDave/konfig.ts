import { Effect } from "effect"
import { parseYamlAll } from "./diff"
import { isParsedDoc, isRawYaml } from "./Manifest"
import type { YamlParseError } from "./RenderError"

// Helm.release yields ParsedDoc wrappers and Manifest.embedYaml a RawYaml one;
// unwrap both so callers get the documents, not the wrapper objects.
export const unwrapDocs = <A>(doc: A): Effect.Effect<ReadonlyArray<unknown>, YamlParseError> =>
  isParsedDoc(doc)
    ? Effect.succeed([doc.value])
    : isRawYaml(doc)
    ? parseYamlAll(doc.content)
    : Effect.succeed([doc])
