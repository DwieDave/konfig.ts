import { Dep } from "@konfig.ts/core"
import { Literal, SecretSource } from "@konfig.ts/env"
import { Environment, Secret } from "@konfig.ts/k8s"
import { Context, Effect } from "effect"

type Expect<T extends true> = T

type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false

const dbCreds = Secret.define({ name: "db-creds", namespace: "prod", env: { url: "DATABASE_URL" } })
const port = Literal.define({ envName: "PORT", value: 8080 })
const apiEnv = Environment.define({ db: dbCreds, port })

const bound = Environment.bind({
  env: apiEnv,
  secrets: { db: { source: SecretSource.literal({ data: { url: "u" } }) } }
})

class Unrelated extends Context.Service<Unrelated, { readonly id: string }>()("Unrelated") {}

declare const needsBoth: Effect.Effect<string, never, Dep.Need<"SecretValues", "db-creds"> | Unrelated>

const provided = needsBoth.pipe(Effect.provide(bound.valuesLayer))

type _UnrelatedSurvives = Expect<
  Equal<
    typeof provided extends Effect.Effect<string, infer _E, infer R> ? R : never,
    Unrelated | import("effect/Scope").Scope | import("@konfig.ts/core").Manifest.RenderServices
  >
>

export type _Tests = readonly [_UnrelatedSurvives]
