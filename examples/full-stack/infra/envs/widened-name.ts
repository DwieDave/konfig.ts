// Demonstrates: `LiteralName<T>` catching a `string`-widened name at a module factory call site.
import { Application } from "@konfig.ts/argocd"
import { Config, Effect } from "effect"
import { cluster } from "../cluster"

const src = (name: string) => ({
  repoURL: cluster.repositoryUrl,
  targetRevision: "main",
  path: `./infra/k8s/manifests/widened/${name}`
})

const _ok = Application.define({
  name: "api",
  namespace: "app",
  source: src("api"),
  build: () => []
})
void _ok

const dynamicName: string = Effect.runSync(Config.string("MY_APP_NAME").pipe(Config.withDefault("api")))
const _widened = Application.define({
  // @ts-expect-error Application name must be a string literal — wrapper widened `Name` to `string`.
  name: dynamicName,
  namespace: "app",
  source: src("api"),
  build: () => []
})
void _widened

const dynamicNs: string = Effect.runSync(Config.string("MY_NS").pipe(Config.withDefault("app")))
const _widenedNs = Application.define({
  name: "api",
  // @ts-expect-error Application namespace must be a string literal.
  namespace: dynamicNs,
  source: src("api"),
  build: () => []
})
void _widenedNs

void Effect.succeed
