import { parseYamlAll } from "@konfig.ts/core"
import { Data, Effect, Result, Schema, Stream } from "effect"
import type { PlatformError } from "effect/PlatformError"
import { ChildProcess, ChildProcessSpawner } from "./_unstable"

export interface ValidationIssue {
  readonly file: string
  readonly doc: number
  readonly path: ReadonlyArray<string | number>
  readonly message: string
}

// Most Kubernetes objects (Deployments, ConfigMaps, CRDs, CustomResources,
// ...) are named per RFC 1123 *subdomain* rules — lowercase alphanumerics,
// '-', and '.', up to 253 chars — which is why e.g. a CustomResourceDefinition
// named `sopssecrets.isindir.github.com` is legal. A handful of kinds are
// stricter and require an RFC 1123 *label* (no dots, max 63 chars):
// Namespace and Service names, and every object's metadata.namespace.
const _DNS_LABEL = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/
const _DNS_SUBDOMAIN = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$/
const _MAX_LABEL_LENGTH = 63
const _MAX_SUBDOMAIN_LENGTH = 253

const _LABEL_NAME_KINDS: ReadonlySet<string> = new Set(["Namespace", "Service"])

type _DnsRule = "label" | "subdomain"

const _dnsRuleDescription = (rule: _DnsRule): string =>
  rule === "label"
    ? "RFC 1123 label — lowercase alphanumeric characters or '-', must start and end with an alphanumeric character, max 63 chars"
    : "RFC 1123 subdomain — lowercase alphanumeric characters, '-', or '.', must start and end with an alphanumeric character, max 253 chars"

interface _CheckDnsNameInput {
  readonly value: string
  readonly rule: _DnsRule
}

// Returns an error message when `value` violates `rule`, `undefined` when it's clean.
const _checkDnsName = (input: _CheckDnsNameInput): string | undefined => {
  const { rule, value } = input
  const pattern = rule === "label" ? _DNS_LABEL : _DNS_SUBDOMAIN
  const maxLength = rule === "label" ? _MAX_LABEL_LENGTH : _MAX_SUBDOMAIN_LENGTH
  if (value.length === 0 || value.length > maxLength || !pattern.test(value)) {
    return `'${value}' is not a valid ${_dnsRuleDescription(rule)}`
  }
  return undefined
}

const _MetadataSchema = Schema.Struct({
  name: Schema.String,
  namespace: Schema.optionalKey(Schema.String),
  labels: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  annotations: Schema.optionalKey(Schema.Record(Schema.String, Schema.String))
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

const _checkNames = (input: _CheckNamesInput): ReadonlyArray<{ path: ReadonlyArray<string>; message: string }> => {
  const { kind, name, namespace } = input
  const issues: Array<{ path: ReadonlyArray<string>; message: string }> = []

  const nameRule: _DnsRule = _LABEL_NAME_KINDS.has(kind) ? "label" : "subdomain"
  const nameError = _checkDnsName({ value: name, rule: nameRule })
  if (nameError !== undefined) {
    issues.push({ path: ["metadata", "name"], message: `metadata.name ${nameError}` })
  }

  if (namespace !== undefined) {
    const namespaceError = _checkDnsName({ value: namespace, rule: "label" })
    if (namespaceError !== undefined) {
      issues.push({ path: ["metadata", "namespace"], message: `metadata.namespace ${namespaceError}` })
    }
  }

  return issues
}

interface ValidateInput {
  readonly file: string
  readonly content: string
}

export const validateManifestFile = (
  input: ValidateInput
): Effect.Effect<ReadonlyArray<ValidationIssue>> =>
  Effect.gen(function*() {
    const issues: ValidationIssue[] = []
    const docsResult = yield* Effect.result(Effect.try({
      try: () => parseYamlAll(input.content),
      catch: (cause) => `YAML parse error: ${String(cause)}`
    }))
    if (Result.isFailure(docsResult)) {
      return [
        {
          file: input.file,
          doc: 0,
          path: [],
          message: docsResult.failure
        }
      ]
    }
    const docs = docsResult.success
    let docIndex = -1
    for (const parsed of docs) {
      docIndex++
      if (parsed === null || typeof parsed !== "object") continue

      const result = yield* Effect.result(_decodeEnvelope(parsed))
      if (Result.isFailure(result)) {
        issues.push({
          file: input.file,
          doc: docIndex,
          path: [],
          message: `does not satisfy KubeManifest envelope: ${String(result.failure)}`
        })
        continue
      }
      const envelope = result.success
      for (
        const nameIssue of _checkNames({
          kind: envelope.kind,
          name: envelope.metadata.name,
          namespace: envelope.metadata.namespace
        })
      ) {
        issues.push({
          file: input.file,
          doc: docIndex,
          path: nameIssue.path,
          message: nameIssue.message
        })
      }
    }
    return issues
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

export interface KubeconformInput {
  readonly dir: string
  readonly extraArgs?: ReadonlyArray<string>
}

const _collectText = (stream: Stream.Stream<Uint8Array, PlatformError>): Effect.Effect<string, PlatformError> =>
  Stream.mkString(Stream.decodeText(stream))

// Pass/fail is decided by the process exit code, not by scraping stdout.
export const runKubeconform = (input: KubeconformInput) =>
  Effect.scoped(
    Effect.gen(function*() {
      const spawner = yield* ChildProcessSpawner
      const args = ["-summary", "-strict", input.dir, ...(input.extraArgs ?? [])]
      const cmd = ChildProcess.make("kubeconform", args)
      const [exitCode, stdout, stderr] = yield* spawner.spawn(cmd).pipe(
        Effect.flatMap((handle) =>
          Effect.all(
            [handle.exitCode, _collectText(handle.stdout), _collectText(handle.stderr)],
            { concurrency: "unbounded" }
          )
        ),
        Effect.mapError(
          (cause) =>
            new KubeconformNotFound({
              hint: `attempted: kubeconform ${args.join(" ")} — ${String(cause)}`
            })
        )
      )
      if (exitCode !== 0) {
        return yield* new KubeconformReportError({ stdout, stderr })
      }
      return stdout
    })
  )
