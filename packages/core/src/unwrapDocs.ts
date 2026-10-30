import { parseYamlAll } from "./diff"
import { isParsedDoc, isRawYaml } from "./Manifest"

// Helm.release yields ParsedDoc wrappers and Manifest.embedYaml a RawYaml one;
// unwrap both so callers get the documents, not the wrapper objects.
export const unwrapDocs = <A>(doc: A): ReadonlyArray<unknown> =>
  isParsedDoc(doc) ? [doc.value] : isRawYaml(doc) ? parseYamlAll(doc.content) : [doc]
