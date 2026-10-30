import { isRecord, objectMetaSchema, parseYamlAll, runProcessCollect } from "@konfig.ts/core"
import { Data, Duration, Effect, Result, Schema } from "effect"
import { ChildProcess } from "effect/process"

export interface ValidationIssue {
  readonly file: string
  readonly doc: number
  readonly path: ReadonlyArray<string | number>
  readonly message: string
}

// Most Kubernetes objects (Deployments, ConfigMaps, CRDs, CustomResources,
// ...) are named per RFC 1123 *subdomain* rules — lowercase alphanumerics,
// '-', and '.', up to 253 chars — which is why e.g. a CustomResourceDefinition
// named `sopssecrets.isindir.github.com` is legal. Exceptions: Namespace uses
// the RFC 1123 *label* rule (no dots, max 63 chars), Service uses the DNS-1035
// label rule (must start with a letter), and RBAC kinds (Role, ClusterRole,
// RoleBinding, ClusterRoleBinding) only need a valid path segment. Every
// object's metadata.namespace is an RFC 1123 label.
const _DNS_LABEL = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/
const _DNS_SUBDOMAIN = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$/
const _MAX_LABEL_LENGTH = 63
const _MAX_SUBDOMAIN_LENGTH = 253

const _DNS_1035_LABEL = /^[a-z]([-a-z0-9]*[a-z0-9])?$/

type _NameRule = "label" | "label1035" | "subdomain" | "pathSegment"

const _NAME_RULES: ReadonlyMap<string, _NameRule> = new Map<string, _NameRule>([
  ["Namespace", "label"],
  ["Service", "label1035"],
  ["Role", "pathSegment"],
  ["ClusterRole", "pathSegment"],
  ["RoleBinding", "pathSegment"],
  ["ClusterRoleBinding", "pathSegment"]
])

const _isPathSegment = (value: string): boolean =>
  value.length > 0 && !/[/%]/.test(value) && value !== "." && value !== ".."

const _isDns1035Label = (value: string): boolean =>
  value.length > 0 && value.length <= _MAX_LABEL_LENGTH && _DNS_1035_LABEL.test(value)

type _DnsRule = "label" | "subdomain"

const _dnsRuleDescription = (rule: _DnsRule): string =>
  rule === "label"
    ? "RFC 1123 label — lowercase alphanumeric characters or '-', must start and end with an alphanumeric character, max 63 chars"
    : "RFC 1123 subdomain — lowercase alphanumeric characters, '-', or '.', must start and end with an alphanumeric character, max 253 chars"

const _NAME_RULE_DESCRIPTIONS: Readonly<Record<_NameRule, string>> = {
  pathSegment: "path segment name — non-empty, must not contain '/' or '%', must not be '.' or '..'",
  label1035:
    "DNS-1035 label — lowercase alphanumeric characters or '-', must start with a letter and end with an alphanumeric character, max 63 chars",
  label: _dnsRuleDescription("label"),
  subdomain: _dnsRuleDescription("subdomain")
}

const _NAME_PREDICATES: Readonly<Record<_NameRule, (value: string) => boolean>> = {
  pathSegment: _isPathSegment,
  label1035: _isDns1035Label,
  label: (value) => checkDnsName({ value, rule: "label" }) === undefined,
  subdomain: (value) => checkDnsName({ value, rule: "subdomain" }) === undefined
}

const _nameViolation = (input: { readonly value: string; readonly rule: _NameRule }): string | undefined =>
  _NAME_PREDICATES[input.rule](input.value)
    ? undefined
    : `'${input.value}' is not a valid ${_NAME_RULE_DESCRIPTIONS[input.rule]}`

interface _CheckDnsNameInput {
  readonly value: string
  readonly rule: _DnsRule
}

// Returns an error message when `value` violates `rule`, `undefined` when it's clean.
export const checkDnsName = (input: _CheckDnsNameInput): string | undefined => {
  const { rule, value } = input
  const pattern = rule === "label" ? _DNS_LABEL : _DNS_SUBDOMAIN
  const maxLength = rule === "label" ? _MAX_LABEL_LENGTH : _MAX_SUBDOMAIN_LENGTH

  if (value.length === 0 || value.length > maxLength || !pattern.test(value)) {
    return `'${value}' is not a valid ${_dnsRuleDescription(rule)}`
  }

  return undefined
}

const _MetadataSchema = Schema.Struct({
  ...objectMetaSchema.fields,
  namespace: Schema.optionalKey(Schema.String)
})

// Only checks the envelope (apiVersion/kind/metadata.name); deeper field
// validation is deferred to `--strict` (kubeconform). The DNS-1123
// name/namespace rules are checked separately in `_checkNames` below because
// which rule applies (label vs. subdomain) depends on `kind`.
const KubeManifestEnvelopeSchema = Schema.Struct({
  apiVersion: Schema.String,
  kind: Schema.String,
  metadata: _MetadataSchema
})

const _decodeEnvelope = Schema.decodeUnknownEffect(KubeManifestEnvelopeSchema)

interface _CheckNamesInput {
  readonly kind: string
  readonly name: string
  readonly namespace: string | undefined
}

const _issueFor = (input: { readonly field: "name" | "namespace"; readonly error: string | undefined }) =>
  input.error === undefined
    ? []
    : [{ path: ["metadata", input.field], message: `metadata.${input.field} ${input.error}` }]

export const _checkNames = (
  input: _CheckNamesInput
): ReadonlyArray<{ path: ReadonlyArray<string>; message: string }> => {
  const { kind, name, namespace } = input
  const nameRule: _NameRule = _NAME_RULES.get(kind) ?? "subdomain"

  return [
    ..._issueFor({ field: "name", error: _nameViolation({ value: name, rule: nameRule }) }),
    ...(namespace === undefined
      ? []
      : _issueFor({ field: "namespace", error: checkDnsName({ value: namespace, rule: "label" }) }))
  ]
}

interface ValidateInput {
  readonly file: string
  readonly content: string
}

const _docIssues = (input: {
  readonly file: string
  readonly doc: number
  readonly parsed: unknown
}) =>
  Effect.gen(function*() {
    const { file, doc, parsed } = input

    if (!isRecord(parsed)) return []
    const result = yield* Effect.result(_decodeEnvelope(parsed))

    if (Result.isFailure(result)) {
      const message = `does not satisfy KubeManifest envelope: ${String(result.failure)}`

      return [{ file, doc, path: [], message }]
    }

    const { kind, metadata } = result.success

    return _checkNames({ kind, name: metadata.name, namespace: metadata.namespace })
      .map((issue) => ({ file, doc, path: issue.path, message: issue.message }))
  })

const _parseDocs = (content: string) =>
  Effect.result(parseYamlAll(content).pipe(Effect.mapError((cause) => `YAML parse error: ${String(cause)}`)))

export const validateManifestFile = (
  input: ValidateInput
): Effect.Effect<ReadonlyArray<ValidationIssue>> =>
  Effect.gen(function*() {
    const docsResult = yield* _parseDocs(input.content)

    if (Result.isFailure(docsResult)) {
      return [{ file: input.file, doc: 0, path: [], message: docsResult.failure }]
    }

    const perDoc = yield* Effect.forEach(
      docsResult.success,
      (parsed, doc) => _docIssues({ file: input.file, doc, parsed })
    )

    return perDoc.flat()
  })

export class KubeconformNotFound extends Data.TaggedError("KubeconformNotFound")<{
  readonly hint: string
}> {
  get message(): string {
    return `kubeconform binary not found — install it for --strict validation (${this.hint})`
  }
}

export class KubeconformReportError extends Data.TaggedError("KubeconformReportError")<{
  readonly stdout: string
  readonly stderr: string
}> {
  get message(): string {
    return `kubeconform reported errors:\n${this.stdout}\n${this.stderr}`
  }
}

interface KubeconformInput {
  readonly dir: string
  readonly extraArgs?: ReadonlyArray<string>
}

const _KUBECONFORM_TIMEOUT = Duration.minutes(5)

// Pass/fail is decided by the process exit code, not by scraping stdout.
export const runKubeconform = (input: KubeconformInput) =>
  Effect.gen(function*() {
    const args = ["-summary", "-strict", ...(input.extraArgs ?? []), input.dir]

    const { exitCode, stdout, stderr } = yield* runProcessCollect({
      command: ChildProcess.make("kubeconform", args),
      timeout: _KUBECONFORM_TIMEOUT
    }).pipe(
      Effect.catchTag("ProcessError", (cause) =>
        Effect.fail(new KubeconformNotFound({ hint: `attempted: kubeconform ${args.join(" ")} — ${String(cause)}` })))
    )

    if (exitCode !== 0) {
      return yield* new KubeconformReportError({ stdout, stderr })
    }

    return stdout
  })
