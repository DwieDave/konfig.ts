import { parseYamlAll } from "@konfig.ts/core"
import { Data, Effect, Result, Schema, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "./_unstable"

/**
 * Per-file, per-document, per-field validation report. Each `Issue`
 * names the file (relative to outDir), the document index within that
 * file (multi-doc YAML support), and the path-to-field with a
 * human-readable message.
 */
export interface ValidationIssue {
  readonly file: string
  readonly doc: number
  readonly path: ReadonlyArray<string | number>
  readonly message: string
}

const _DNSLabel = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/

const _MetadataSchema = Schema.Struct({
  name: Schema.String.check(
    Schema.isPattern(_DNSLabel, {
      description: "Kubernetes name (RFC 1123 label)"
    })
  ),
  namespace: Schema.optionalKey(
    Schema.String.check(
      Schema.isPattern(_DNSLabel, {
        description: "Kubernetes namespace (RFC 1123 label)"
      })
    )
  ),
  labels: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  annotations: Schema.optionalKey(Schema.Record(Schema.String, Schema.String))
})

/**
 * Minimum envelope every Kubernetes manifest must satisfy: an
 * apiVersion, a kind, and a metadata block with a valid name. Deeper
 * field-level validation against the kubernetes-types interfaces would
 * require Effect Schemas mirroring every K8s resource — that work
 * lives behind `--strict` (kubeconform).
 */
export const KubeManifestEnvelopeSchema = Schema.Struct({
  apiVersion: Schema.String,
  kind: Schema.String,
  metadata: _MetadataSchema
})

const _decodeEnvelope = Schema.decodeUnknownEffect(KubeManifestEnvelopeSchema)

interface ValidateInput {
  readonly file: string
  readonly content: string
}

export const validateManifestFile = (
  input: ValidateInput
): Effect.Effect<ReadonlyArray<ValidationIssue>> =>
  Effect.gen(function*() {
    const issues: ValidationIssue[] = []
    let docs: ReadonlyArray<unknown>
    try {
      // parseYamlAll splits on real YAML document boundaries — a `---`
      // inside a block scalar stays part of its document, unlike a naive
      // /^---$/m regex split.
      docs = parseYamlAll(input.content)
    } catch (cause) {
      return [
        {
          file: input.file,
          doc: 0,
          path: [],
          message: `YAML parse error: ${String(cause)}`
        }
      ]
    }
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

const _collectText = (stream: Stream.Stream<Uint8Array, unknown>): Effect.Effect<string, unknown> =>
  Stream.mkString(Stream.decodeText(stream))

/**
 * Shell out to `kubeconform -summary -strict` over the rendered
 * directory. Caller threads in extra flags (e.g.
 * `--ignore-missing-schemas` for CRDs the bundled schema set doesn't
 * know about). Pass/fail is decided by the process exit code, not by
 * scraping stdout: a non-zero exit fails with `KubeconformReportError`
 * carrying both the stdout summary and stderr so the full report reaches
 * the user. A spawn failure (kubeconform not installed) fails with
 * `KubeconformNotFound`.
 */
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
        return yield* Effect.fail(new KubeconformReportError({ stdout, stderr }))
      }
      return stdout
    })
  )
