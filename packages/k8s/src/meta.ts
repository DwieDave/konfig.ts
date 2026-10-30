export type StringMap = Readonly<Record<string, string>>

export interface MetaLabels {
  readonly labels?: StringMap
  readonly annotations?: StringMap
}

export interface ClusterMetaInput extends MetaLabels {
  readonly name: string
}

export interface NamespacedMetaInput extends ClusterMetaInput {
  readonly namespace: string
}

export interface PodTemplateMetaInput extends MetaLabels {}

export interface ObjectMetaOutput {
  name: string
  namespace?: string
  labels?: Record<string, string>
  annotations?: Record<string, string>
}

export const copyMap = (map: StringMap | undefined): Record<string, string> | undefined =>
  map === undefined ? undefined : { ...map }

export const cloneList = <T>(items: ReadonlyArray<T> | undefined): Array<T> | undefined =>
  items === undefined ? undefined : structuredClone([...items])

export const nonEmpty = (map: StringMap): StringMap | undefined => Object.keys(map).length === 0 ? undefined : map

export const toLabelsMeta = (
  input: MetaLabels | undefined
): { labels?: Record<string, string>; annotations?: Record<string, string> } | undefined =>
  input === undefined
    ? undefined
    : { labels: copyMap(input.labels), annotations: copyMap(input.annotations) }

const _named = (input: ClusterMetaInput & { readonly namespace?: string }) =>
  input.namespace === undefined ? { name: input.name } : { name: input.name, namespace: input.namespace }

export const toObjectMeta = (
  input: ClusterMetaInput & { readonly namespace?: string }
): ObjectMetaOutput => ({
  ..._named(input),
  labels: copyMap(input.labels),
  annotations: copyMap(input.annotations)
})
