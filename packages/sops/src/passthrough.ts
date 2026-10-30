import { Manifest, RenderError } from "@konfig.ts/core"
import { type BackendEmitInput, backendLabel } from "@konfig.ts/k8s"
import { Effect } from "effect"
import { FileSystem } from "effect/FileSystem"
import type { SopsSecret } from "./crd"
import { parseVerified } from "./verify"

type _Record = Readonly<Record<string, string>>

interface _RestampInput {
  readonly decoded: SopsSecret
  readonly namespace: string
  readonly name: string
  readonly label: string
  readonly labels?: _Record | undefined
  readonly annotations?: _Record | undefined
}

interface _Mismatch {
  readonly namespace: boolean
  readonly name: boolean
  readonly labels: boolean
  readonly annotations: boolean
}

const _differs = (want: _Record | undefined, have: _Record | undefined): boolean =>
  want !== undefined && Object.entries(want).some(([key, value]) => have?.[key] !== value)

const _mismatches = ({ annotations, decoded, labels, name, namespace }: _RestampInput): _Mismatch => ({
  namespace: decoded.metadata.namespace !== namespace,
  name: decoded.metadata.name !== name
    || decoded.spec.secretTemplates.some((template) => template.name !== name),
  labels: _differs(labels, decoded.metadata.labels),
  annotations: _differs(annotations, decoded.metadata.annotations)
})

const _describeTargets = (input: _RestampInput, mismatch: _Mismatch): string =>
  [
    mismatch.namespace ? `metadata.namespace to "${input.namespace}"` : undefined,
    mismatch.name ? `metadata.name/spec.secretTemplates[].name to "${input.name}"` : undefined,
    mismatch.labels ? "metadata.labels" : undefined,
    mismatch.annotations ? "metadata.annotations" : undefined
  ].filter((target): target is string => target !== undefined).join(" and ")

const _mergedRecord = (input: {
  readonly key: "labels" | "annotations"
  readonly have: _Record | undefined
  readonly want: _Record | undefined
}) => input.want === undefined ? {} : { [input.key]: { ...input.have, ...input.want } }

const _applyIdentity = (input: _RestampInput): SopsSecret => ({
  ...input.decoded,
  metadata: {
    ...input.decoded.metadata,
    namespace: input.namespace,
    name: input.name,
    ..._mergedRecord({ key: "labels", have: input.decoded.metadata.labels, want: input.labels }),
    ..._mergedRecord({ key: "annotations", have: input.decoded.metadata.annotations, want: input.annotations })
  },
  spec: {
    ...input.decoded.spec,
    secretTemplates: input.decoded.spec.secretTemplates.map((template) => ({ ...template, name: input.name }))
  }
})

const _isClean = (mismatch: _Mismatch): boolean => !Object.values(mismatch).some(Boolean)

export const _restampIdentity = (input: _RestampInput): Effect.Effect<SopsSecret, RenderError> => {
  const mismatch = _mismatches(input)

  if (_isClean(mismatch)) return Effect.succeed(input.decoded)

  if (input.decoded.sops.mac_only_encrypted !== true) {
    return Effect.fail(
      new RenderError({
        message: `${input.label}: refusing to restamp ${
          _describeTargets(input, mismatch)
        } — file is fully MAC'd (mac_only_encrypted is not true), so it is protected by the MAC`
      })
    )
  }

  return Effect.succeed(_applyIdentity(input))
}

export const _assertSingleTemplate = (
  input: { readonly decoded: SopsSecret; readonly label: string }
): Effect.Effect<void, RenderError> =>
  input.decoded.spec.secretTemplates.length > 1
    ? Effect.fail(
      new RenderError({
        message:
          `${input.label}: passthrough supports exactly one spec.secretTemplates entry, found ${input.decoded.spec.secretTemplates.length}`
      })
    )
    : Effect.void

export const _assertCoversKeys = (input: {
  readonly decoded: SopsSecret
  readonly keys: ReadonlyArray<string>
  readonly label: string
}): Effect.Effect<void, RenderError> => {
  const present = new Set(
    input.decoded.spec.secretTemplates.flatMap((template) => [
      ...Object.keys(template.stringData ?? {}),
      ...Object.keys(template.data ?? {})
    ])
  )

  const missing = input.keys.filter((key) => !present.has(key))

  return missing.length === 0
    ? Effect.void
    : Effect.fail(
      new RenderError({
        message: `${input.label}: file is missing keys required by the secret contract: ${missing.join(", ")}`
      })
    )
}

const _readFile = (input: { readonly file: string; readonly label: string }) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem

    return yield* fs.readFileString(input.file).pipe(
      Effect.mapError((cause) => new RenderError({ message: `${input.label}: could not read ${input.file}`, cause }))
    )
  })

export const passthroughManifest = <N extends string, K extends string>(input: {
  readonly base: BackendEmitInput<N, K, false>
  readonly file: string
}): Manifest.Manifest<SopsSecret> =>
  Manifest.make<SopsSecret>((_ctx) =>
    Effect.gen(function*() {
      const { base } = input
      const label = backendLabel({ tag: "Sops.passthrough", base })

      const decoded = yield* _readFile({ file: input.file, label }).pipe(
        Effect.flatMap((yamlText) => parseVerified({ yamlText, label }))
      )

      yield* _assertSingleTemplate({ decoded, label })
      yield* _assertCoversKeys({ decoded, keys: base.keys, label })

      return yield* _restampIdentity({
        decoded,
        namespace: base.namespace,
        name: base.name,
        labels: base.labels,
        annotations: base.annotations,
        label
      })
    })
  )
