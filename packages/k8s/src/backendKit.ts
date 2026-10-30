import {
  boundary,
  type BoundaryDecodeError,
  decodeYamlOutput,
  Manifest,
  RenderError,
  runCliWithStdin,
  unsafeCoerce,
  Yaml
} from "@konfig.ts/core"
import type { SecretSource } from "@konfig.ts/env"
import { type Duration, Effect, Redacted, type Schema } from "effect"
import type { Secret as K8sSecret } from "./.generated/k8s-types"
import { resolveSource } from "./backend"
import { type StringMap, toObjectMeta } from "./meta"

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

export interface EmitInput<N extends string, K extends string, Opts, RS extends boolean = true> {
  readonly base: BackendEmitInput<N, K, RS>
  readonly opts: Opts
  readonly label: string
}

export interface SecretBackend<
  N extends string,
  K extends string,
  RequiresSource extends boolean = boolean,
  Out = unknown
> {
  readonly _tag: string
  readonly requiresSource: RequiresSource
  readonly emit: (input: BackendEmitInput<N, K, RequiresSource>) => Manifest.Manifest<Out>
}

export interface CliBackendOptions {
  readonly type?: string
  readonly timeout?: Duration.Input
}

type OptsArgs<Opts> = {} extends Opts ? [opts?: Opts] : [opts: Opts]

export const resolvePlaintext = <N extends string, K extends string>(input: {
  readonly base: BackendEmitInput<N, K, true>
  readonly label: string
}): Effect.Effect<Record<string, string>, RenderError, Manifest.RenderServices> =>
  resolveSource({ source: input.base.source, label: input.label }).pipe(
    Effect.map((resolved) => Object.fromEntries(input.base.keys.map((key) => [key, Redacted.value(resolved[key])])))
  )

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

interface DefineInput<Opts, RS extends boolean, Out> {
  readonly tag: string
  readonly requiresSource: RS
  readonly emit: <N extends string, K extends string>(
    input: EmitInput<N, K, Opts, RS>
  ) => Manifest.Manifest<Out>
}

const _label = (input: { readonly tag: string; readonly base: BackendEmitInput<string, string> }): string =>
  `${input.tag}(${input.base.namespace}/${input.base.name})`

const _optsOrEmpty = <Opts>(opts: Opts | undefined): Opts =>
  opts ?? unsafeCoerce<Opts>({ value: {}, reason: "OptsArgs only makes opts optional when {} satisfies Opts" })

const _define =
  <Opts, RS extends boolean, Out>(input: DefineInput<Opts, RS, Out>) =>
  <N extends string, K extends string>(...[opts]: OptsArgs<Opts>): SecretBackend<N, K, RS, Out> => ({
    _tag: input.tag,
    requiresSource: input.requiresSource,
    emit: (base) => input.emit({ base, opts: _optsOrEmpty(opts), label: _label({ tag: input.tag, base }) })
  })

export const SecretBackend = { define: _define }

interface EncryptingInput<Opts extends CliBackendOptions, Pre, S extends Schema.Top> {
  readonly tag: string
  readonly precheck: (input: { readonly opts: Opts; readonly label: string }) => Effect.Effect<Pre, RenderError>
  readonly toPlain: <N extends string, K extends string>(input: {
    readonly base: BackendEmitInput<N, K, true>
    readonly opts: Opts
    readonly stringData: Record<string, string>
  }) => object
  readonly bin: string
  readonly args: (input: {
    readonly opts: Opts
    readonly pre: Pre
    readonly label: string
  }) => Effect.Effect<ReadonlyArray<string>, RenderError | BoundaryDecodeError>
  readonly schema: S & { readonly DecodingServices: never }
  readonly schemaLabel: string
  readonly verify?: (input: {
    readonly decoded: S["Type"]
    readonly label: string
  }) => Effect.Effect<void, RenderError>
}

const _decodeOutput = <Opts extends CliBackendOptions, Pre, S extends Schema.Top>(input: {
  readonly def: EncryptingInput<Opts, Pre, S>
  readonly text: string
  readonly label: string
}) =>
  decodeYamlOutput({
    text: input.text,
    label: input.label,
    what: `${input.def.bin} failed`,
    decode: boundary({ schema: input.def.schema, label: input.def.schemaLabel })
  }).pipe(
    Effect.tap((decoded) => input.def.verify?.({ decoded, label: input.label }) ?? Effect.void)
  )

const _encrypt = <Opts extends CliBackendOptions, Pre, S extends Schema.Top>(input: {
  readonly def: EncryptingInput<Opts, Pre, S>
  readonly opts: Opts
  readonly pre: Pre
  readonly label: string
}) =>
(plainYaml: string) =>
  input.def.args({ opts: input.opts, pre: input.pre, label: input.label }).pipe(
    Effect.flatMap((args) =>
      runCliWithStdin({
        bin: input.def.bin,
        args,
        stdin: plainYaml,
        label: input.label,
        timeout: input.opts.timeout
      })
    )
  )

const encryptingBackend = <Opts extends CliBackendOptions, Pre, S extends Schema.Top>(
  def: EncryptingInput<Opts, Pre, S>
) =>
  _define<Opts, true, S["Type"]>({
    tag: def.tag,
    requiresSource: true,
    emit: ({ base, label, opts }) =>
      Manifest.make<S["Type"]>(() =>
        def.precheck({ opts, label }).pipe(
          Effect.flatMap((pre) =>
            encryptVia({
              base,
              label,
              toPlain: (stringData) => def.toPlain({ base, opts, stringData }),
              encrypt: _encrypt({ def, opts, pre, label }),
              verify: (text) => _decodeOutput({ def, text, label })
            })
          )
        )
      )
  })

export { encryptingBackend }
