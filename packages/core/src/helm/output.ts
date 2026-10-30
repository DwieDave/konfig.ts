import { Data, Effect, Predicate, Schema } from "effect"
import { parseYamlAll } from "../diff"
import type { ParsedDoc } from "../Manifest"
import type { YamlParseError } from "../RenderError"

const CLUSTER_SCOPED_KINDS: ReadonlySet<string> = new Set([
  "APIService",
  "CertificateSigningRequest",
  "ClusterRole",
  "ClusterRoleBinding",
  "ClusterTrustBundle",
  "ComponentStatus",
  "CSIDriver",
  "CSINode",
  "CustomResourceDefinition",
  "DeviceClass",
  "FlowSchema",
  "IngressClass",
  "IPAddress",
  "MutatingAdmissionPolicy",
  "MutatingAdmissionPolicyBinding",
  "MutatingWebhookConfiguration",
  "Namespace",
  "Node",
  "PersistentVolume",
  "PodSecurityPolicy",
  "PriorityClass",
  "PriorityLevelConfiguration",
  "ResourceSlice",
  "RuntimeClass",
  "SelfSubjectAccessReview",
  "SelfSubjectReview",
  "SelfSubjectRulesReview",
  "ServiceCIDR",
  "StorageClass",
  "StorageVersion",
  "StorageVersionMigration",
  "SubjectAccessReview",
  "TokenReview",
  "ValidatingAdmissionPolicy",
  "ValidatingAdmissionPolicyBinding",
  "ValidatingWebhookConfiguration",
  "VolumeAttachment",
  "VolumeAttributesClass"
])

interface _ParseHelmOutputInput {
  readonly output: string
  readonly chart: string
  readonly version: string
  readonly namespace: string | undefined
  readonly clusterScopedKinds?: ReadonlyArray<string>
}

const _CrdSchema = Schema.Struct({
  kind: Schema.Literal("CustomResourceDefinition"),
  spec: Schema.Struct({
    scope: Schema.Literal("Cluster"),
    names: Schema.Struct({ kind: Schema.String })
  })
})

const _isClusterCrd = Schema.is(_CrdSchema)

const _crdClusterKinds = (docs: ReadonlyArray<unknown>): ReadonlyArray<string> =>
  docs.flatMap((doc) => _isClusterCrd(doc) ? [doc.spec.names.kind] : [])

interface _ScopedKindsInput {
  readonly docs: ReadonlyArray<unknown>
  readonly extra: ReadonlyArray<string>
}

const _scopedKinds = ({ docs, extra }: _ScopedKindsInput): ReadonlySet<string> =>
  new Set([...CLUSTER_SCOPED_KINDS, ...extra, ..._crdClusterKinds(docs)])

interface _StampInput {
  readonly doc: unknown
  readonly namespace: string
  readonly clusterKinds: ReadonlySet<string>
}

type _ParsedDocEnum = Data.TaggedEnum<{ ParsedDoc: Omit<ParsedDoc, "_tag"> }>

const { ParsedDoc: _parsedDoc } = Data.taggedEnum<_ParsedDocEnum>()

const _NamedDocSchema = Schema.Struct({
  kind: Schema.String,
  metadata: Schema.optional(Schema.NullOr(Schema.Record(Schema.String, Schema.Unknown)))
})

const _isNamedDoc = Schema.is(_NamedDocSchema)

const _stampNamespace = ({ doc, namespace, clusterKinds }: _StampInput): ParsedDoc["value"] => {
  if (!_isNamedDoc(doc) || clusterKinds.has(doc.kind)) return doc
  const ns = doc.metadata?.["namespace"]

  return Predicate.isNullish(ns) || ns === "" ? { ...doc, metadata: { ...doc.metadata, namespace } } : doc
}

// Uses parseYamlAll (not a naive /^---$/m split) so a `---` inside a block scalar can't
// spuriously split one manifest into two. Docs stay parsed (ParsedDoc, not
// RawYaml): re-stringifying here only for the CLI to parse and serialize again
// roughly doubled the CPU spent per helm doc.
export const _parseHelmOutput = (input: _ParseHelmOutputInput): Effect.Effect<ParsedDoc[], YamlParseError> =>
  Effect.gen(function*() {
    const { output, chart, version, namespace } = input
    const origin = `helm:${chart}@${version}`
    const docs = yield* parseYamlAll(output)
    const clusterKinds = _scopedKinds({ docs, extra: input.clusterScopedKinds ?? [] })

    return docs.map((doc) =>
      _parsedDoc({
        value: namespace === undefined ? doc : _stampNamespace({ doc, namespace, clusterKinds }),
        origin
      })
    )
  })
