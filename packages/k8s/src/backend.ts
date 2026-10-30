import { type Manifest, parseYamlWith, RenderError, runProcessWithStdin, Yaml } from "@konfig.ts/core"
import type { ResolvedSecretValues, SecretSource } from "@konfig.ts/env"
import { type Duration, Effect, Redacted, Schema } from "effect"
import { ChildProcess } from "effect/process"
import type { Secret as K8sSecret } from "./.generated/k8s-types"
import { type StringMap, toObjectMeta } from "./meta"

type BackendTag = string

export interface EmitInput<N extends string, K extends string, Opts, RS extends boolean = true> {
  readonly base: BackendEmitInput<N, K, RS>
  readonly opts: Opts
}

export const resolveSource = <K extends string, R>(input: {
  readonly source: SecretSource<K, R>
  readonly label: string
}): Effect.Effect<ResolvedSecretValues<K>, RenderError, R> =>
  input.source.resolve.pipe(
    Effect.mapError(
      (cause) =>
        new RenderError({
          message: `${input.label}: source failed for key "${cause.key}"`,
          cause
        })
    )
  )

export const resolvePlaintext = <N extends string, K extends string>(input: {
  readonly base: BackendEmitInput<N, K, true>
  readonly label: string
}): Effect.Effect<Record<string, string>, RenderError, Manifest.RenderServices> =>
  resolveSource({ source: input.base.source, label: input.label }).pipe(
    Effect.map((resolved) => Object.fromEntries(input.base.keys.map((key) => [key, Redacted.value(resolved[key])])))
  )

export interface BackendEmitInput<
  N extends string,
  K extends string,
  RequiresSource extends boolean = boolean
> {
  readonly name: N
  readonly namespace: string
  readonly keys: ReadonlyArray<K>
  readonly labels?: StringMap
  readonly annotations?: StringMap
  readonly source: RequiresSource extends true ? SecretSource<K, Manifest.RenderServices>
    : SecretSource<K, Manifest.RenderServices> | undefined
}

export interface SecretBackend<
  N extends string,
  K extends string,
  RequiresSource extends boolean = boolean,
  Out = unknown
> {
  readonly _tag: BackendTag
  readonly requiresSource: RequiresSource
  readonly emit: (input: BackendEmitInput<N, K, RequiresSource>) => Manifest.Manifest<Out>
}

interface _MakeBackendInput<N extends string, K extends string, RequiresSource extends boolean, Out> {
  readonly tag: BackendTag
  readonly requiresSource: RequiresSource
  readonly emit: (input: {
    readonly base: BackendEmitInput<N, K, RequiresSource>
    readonly label: string
  }) => Manifest.Manifest<Out>
}

const _label = (input: { readonly tag: BackendTag; readonly base: BackendEmitInput<string, string> }): string =>
  `${input.tag}(${input.base.namespace}/${input.base.name})`

export const SecretBackend = {
  make: <N extends string, K extends string, RequiresSource extends boolean, Out = unknown>(
    input: _MakeBackendInput<N, K, RequiresSource, Out>
  ): SecretBackend<N, K, RequiresSource, Out> => ({
    _tag: input.tag,
    requiresSource: input.requiresSource,
    emit: (base) => input.emit({ base, label: _label({ tag: input.tag, base }) })
  })
}

export const secretMeta = <N extends string, K extends string>(base: BackendEmitInput<N, K>) =>
  toObjectMeta({
    name: base.name,
    namespace: base.namespace,
    labels: base.labels,
    annotations: base.annotations
  })

export const plainSecret = <N extends string, K extends string>(input: {
  readonly base: BackendEmitInput<N, K>
  readonly type?: string
  readonly stringData: Record<string, string>
  readonly immutable?: boolean
}): K8sSecret => ({
  apiVersion: "v1",
  kind: "Secret",
  metadata: secretMeta(input.base),
  type: input.type,
  stringData: input.stringData,
  immutable: input.immutable
})

export const encryptVia = <N extends string, K extends string, P extends object, A, E, R, EE, RE>(input: {
  readonly base: BackendEmitInput<N, K, true>
  readonly label: string
  readonly toPlain: (stringData: Record<string, string>) => P
  readonly encrypt: (plainYaml: string) => Effect.Effect<string, EE, RE>
  readonly verify: (output: string) => Effect.Effect<A, E, R>
}): Effect.Effect<A, RenderError | EE | E, Manifest.RenderServices | RE | R> =>
  resolvePlaintext({ base: input.base, label: input.label }).pipe(
    Effect.map((stringData) => Yaml.serialize({ value: input.toPlain(stringData) })),
    Effect.flatMap(input.encrypt),
    Effect.flatMap(input.verify)
  )

export const encryptWithCli = (input: {
  readonly bin: string
  readonly args: ReadonlyArray<string>
  readonly stdin: string
  readonly label: string
  readonly timeout?: Duration.Input | undefined
}) =>
  runProcessWithStdin({
    command: ChildProcess.make(input.bin, input.args),
    stdin: input.stdin,
    label: `${input.label}: ${input.bin}`,
    timeout: input.timeout
  }).pipe(
    Effect.catchTag("ProcessInvocationError", (cause) =>
      Effect.fail(new RenderError({ message: `${input.label}: ${input.bin} failed`, cause })))
  )

type YamlDocument = Schema.Schema.Type<typeof Schema.Unknown>

export const decodeYamlOutput = <A, E, R>(input: {
  readonly text: string
  readonly label: string
  readonly what?: string
  readonly decode: (parsed: YamlDocument) => Effect.Effect<A, E, R>
}): Effect.Effect<A, RenderError | E, R> =>
  parseYamlWith({
    text: input.text,
    schema: Schema.Unknown,
    onError: (cause) =>
      new RenderError({
        message: `${input.label}: ${input.what === undefined ? "" : `${input.what} — `}output was not valid YAML`,
        cause
      })
  }).pipe(Effect.flatMap(input.decode))
