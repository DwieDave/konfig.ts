import { Manifest, Yaml } from "@konfig.ts/core"
import { Effect, type Types } from "effect"
import type { Any as AnyApp } from "./Application"
import type { AppOfAppsDefaults, AppOfAppsTarget } from "./AppOfApps"
import { mergeSyncPolicy } from "./syncPolicy"

interface ApplicationCR {
  readonly apiVersion: "argoproj.io/v1alpha1"
  readonly kind: "Application"
  readonly metadata: {
    readonly annotations?: Readonly<Record<string, string>>
    readonly name: string
    readonly namespace: string
  }
  readonly spec: {
    readonly destination: {
      readonly namespace: string
      readonly server: string
    }
    readonly project: string
    readonly source: {
      readonly path: string
      readonly repoURL: string
      readonly targetRevision: string
    }
    readonly syncPolicy?: unknown
  }
}

export interface BuildCRInput {
  readonly app: AnyApp
  readonly target: AppOfAppsTarget
  readonly defaults: AppOfAppsDefaults
}

const _metadata = (
  input: { readonly app: AnyApp; readonly controllerNamespace: string }
): ApplicationCR["metadata"] => {
  const { app, controllerNamespace } = input
  const metadata: Types.Mutable<ApplicationCR["metadata"]> = { name: app.name, namespace: controllerNamespace }

  if (app.annotations !== undefined && Object.keys(app.annotations).length > 0) metadata.annotations = app.annotations

  return metadata
}

const _source = (app: AnyApp): ApplicationCR["spec"]["source"] => ({
  path: app.source.path,
  repoURL: app.source.repoURL,
  targetRevision: app.source.targetRevision
})

const _spec = (input: BuildCRInput): ApplicationCR["spec"] => {
  const { app, defaults } = input
  const syncPolicy = mergeSyncPolicy({ def: defaults.syncPolicy, app: app.syncPolicy })

  const spec: Types.Mutable<ApplicationCR["spec"]> = {
    destination: {
      namespace: app.namespace,
      server: defaults.destination?.server ?? "https://kubernetes.default.svc"
    },
    project: app.project ?? defaults.project ?? "default",
    source: _source(app)
  }

  if (syncPolicy !== undefined) spec.syncPolicy = syncPolicy

  return spec
}

export const buildCR = (input: BuildCRInput): ApplicationCR => ({
  apiVersion: "argoproj.io/v1alpha1",
  kind: "Application",
  metadata: _metadata({ app: input.app, controllerNamespace: input.target.controllerNamespace ?? "argocd" }),
  spec: _spec(input)
})

export const serializeApplicationCR = (input: BuildCRInput): string => Yaml.serialize({ value: buildCR(input) })

export const emitApplicationCR = (input: BuildCRInput): Manifest.Manifest<string> => {
  const yaml = serializeApplicationCR(input)

  return Manifest.make<string>(() => Effect.succeed(yaml))
}

export const applicationCRFilename = (app: AnyApp): string =>
  Yaml.filenameFor({ kind: "Application", metadata: { name: app.name } })
