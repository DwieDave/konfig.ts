import { loadSnippet, type Snippet, type SnippetSpec } from "./snippets"

/** Every code sample on the page, sourced from `examples/full-stack`. */

export type FailureCaseId =
  | "missing-provider"
  | "unbound-secret"
  | "port-mismatch"
  | "volume-mismatch"
  | "envname-collision"
  | "widened-name"
  | "app-name-collision"

/** The cases shown in the landing page tabs, in order. The rest are used by the docs. */
export const LANDING_CASE_IDS: ReadonlyArray<FailureCaseId> = [
  "missing-provider",
  "unbound-secret",
  "port-mismatch",
  "volume-mismatch",
  "envname-collision"
]

export interface FailureCase {
  readonly id: FailureCaseId
  readonly tab: string
  readonly title: string
  readonly summary: string
  readonly spec: SnippetSpec
  /** The abridged `tsc` line printed under the editor. */
  readonly tsc: string
}

const MISSING_PROVIDER =
  `Missing provider for Image "api", Image "worker" and Secret "ghcr-pull".
Add a module that provides them to AppOfApps.fromModules({ modules }), or check that providers come before consumers in the list.`

export const FAILURE_CASES: ReadonlyArray<FailureCase> = [
  {
    id: "missing-provider",
    tab: "broken.ts",
    title: "A module needs a Secret nobody provides",
    summary:
      "`api` and `worker` do `yield* Dep.Secret(\"ghcr-pull\")` and `yield* Dep.Image(...)` in their builds. Leave the `imagePulls` and build modules out of the list and `entrypoint` refuses to compile.",
    spec: {
      file: "infra/envs/broken.ts",
      stripMeta: true,
      between: { startAt: "const api = defineApi" },
      diagnostics: [
        {
          find: "AppOfApps.fromModules({",
          code: "2345",
          message: MISSING_PROVIDER
        }
      ]
    },
    tsc: `infra/envs/broken.ts(30,3): error TS2345: Property '_konfig_unsatisfied' is missing … "Missing provider for Image \\"api\\"…" | "Missing provider for Image \\"worker\\"…" | "Missing provider for Secret \\"ghcr-pull\\"…"`
  },
  {
    id: "unbound-secret",
    tab: "unbound-secret.ts",
    title: "An env contract with a secret you forgot to bind",
    summary:
      "`apiEnv` declares three secret members. `Environment.bind` demands a backend for each one, and a `source` when the backend's type says it needs one.",
    spec: {
      file: "infra/envs/unbound-secret.ts",
      stripMeta: true,
      between: { startAfter: "void _missingSecretsField", endBefore: "void _missingSource" },
      diagnostics: [
        {
          on: "  secrets: {",
          find: "secrets",
          code: "2741",
          message: `Property 'jwt' is missing in secrets.\nEvery secret member of apiEnv (db, s3, jwt) needs a backend.`
        },
        {
          on: "    db: {},",
          find: "db: {}",
          code: "2322",
          message: `Type '{}' is not assignable to SecretMemberOptions<"db-creds">.\nA member needs at least a backend.`
        },
        {
          on: "    db: { backend: sopsBackend },",
          find: "db: { backend: sopsBackend }",
          code: "2322",
          message: `Property 'source' is missing.\nSops.backend requires a source; its type says requiresSource: true.`
        }
      ]
    },
    tsc: `infra/envs/unbound-secret.ts(39,3): error TS2741: Property 'jwt' is missing in type '{ db: …; s3: … }' but required in type 'SecretMembersOpts<…>'.`
  },
  {
    id: "port-mismatch",
    tab: "port-mismatch.ts",
    title: "A probe or Service pointing at a port that does not exist",
    summary:
      "`Port.make` declares the container's port names; `Port.ref` is only accepted for one of them. A typo in a readiness probe or a Service `targetPort` is a compile error, not a pod that never becomes ready.",
    spec: {
      file: "infra/envs/port-mismatch.ts",
      stripMeta: true,
      between: { startAt: "const api = Container.define({", endBefore: "const _ok = Workload.web({" },
      diagnostics: [
        {
          find: 'Port.ref("htp")',
          code: "2322",
          message: `Type 'PortName<"htp">' is not assignable to type 'number | PortName<"http">'.
The container declares only the port "http".`
        },
        {
          find: 'Port.ref("metrics")',
          code: "2322",
          message: `Type 'PortName<"metrics">' is not assignable to type 'number | PortName<"http">'.
No container in this workload declares a port named "metrics".`
        }
      ]
    },
    tsc: `infra/envs/port-mismatch.ts(10,34): error TS2322: Type 'PortName<"htp">' is not assignable to type 'number | PortName<"http">'.`
  },
  {
    id: "volume-mismatch",
    tab: "volume-mismatch.ts",
    title: "A mount or PVC claim that does not match a declared volume",
    summary:
      "Volume mounts must name a volume the pod declares, and a PVC claim must be a branded reference, not a string. Both are checked when the pod is defined.",
    spec: {
      file: "infra/envs/volume-mismatch.ts",
      stripMeta: true,
      between: { startAt: "const data = Volume.fromPvc", endBefore: "const _ok = Pod.define({" },
      diagnostics: [
        {
          find: "Container.define({",
          on: "    Container.define({",
          code: "2322",
          message: `Type 'ContainerSpec<"pg", "dat">' is not assignable to type 'ContainerSpec<string, "data">'.
The pod declares only the volume "data"; the mount names "dat".`
        },
        {
          find: 'claim: "postgres-data"',
          code: "2322",
          message: `Type 'string' is not assignable to type 'PvcRef<string>'.
Use PvcRef.of("postgres-data") or a Dep.Pvc provider so the claim is tracked.`
        }
      ]
    },
    tsc: `infra/envs/volume-mismatch.ts(10,5): error TS2322: Type 'ContainerSpec<"pg", "dat">' is not assignable to type 'ContainerSpec<string, "data">'.`
  },
  {
    id: "widened-name",
    tab: "widened-name.ts",
    title: "An Application name that isn't a literal",
    summary:
      "Names flow into the dep graph as string literals. Widen one to `string` and the graph can't reason about it, so the call site rejects it.",
    spec: {
      file: "infra/envs/widened-name.ts",
      stripMeta: true,
      between: { startAfter: "void _ok", endBefore: "void _widened" },
      diagnostics: [
        {
          find: "name: dynamicName",
          code: "2322",
          message: `Type 'string' is not assignable to type '{ readonly _konfig_error: "Module name/namespace must be a string literal." }'.\nMake the wrapper generic (<const Name extends string>) and forward via Module.LiteralName<Name>.`
        }
      ]
    },
    tsc: `infra/envs/widened-name.ts(23,3): error TS2322: Type 'string' is not assignable to type '{ readonly _konfig_error: "Module name/namespace must be a string literal…" }'.`
  },
  {
    id: "envname-collision",
    tab: "envname-collision.ts",
    title: "Two members claiming the same env var",
    summary:
      "`Environment.define` checks env names across every member (literals, secrets, downward) at the type level. A collision is an error on the call.",
    spec: {
      file: "infra/envs/envname-collision.ts",
      stripMeta: true,
      between: { startAfter: "void _literalDup", endBefore: "void _secretLiteralDup" },
      diagnostics: [
        {
          find: "Environment.define({",
          code: "2345",
          message: `Property '_konfig_error' is missing but required in type _EnvNameCollisionError<"DATABASE_URL">.\nTwo members claim the env var DATABASE_URL.`
        }
      ]
    },
    tsc: `infra/envs/envname-collision.ts(23,46): error TS2345: Property '_konfig_error' is missing … but required in type '_EnvNameCollisionError<"DATABASE_URL">'.`
  },
  {
    id: "app-name-collision",
    tab: "app-name-collision.ts",
    title: "Two Applications with the same name",
    summary:
      "The later module would silently shadow the earlier one in Argo CD. `fromModules` sees both `Provide<\"App\", \"api\">` and stops you.",
    spec: {
      file: "infra/envs/app-name-collision.ts",
      stripMeta: true,
      between: { startAt: "const apiV1 = Application.define({" },
      diagnostics: [
        {
          find: "modules: [apiV1, apiV2]",
          code: "2345",
          message: `Duplicate App "api": two modules in AppOfApps.fromModules({ modules }) provide the same name; the later one silently shadows the earlier.\nRename one of them.`
        }
      ]
    },
    tsc: `infra/envs/app-name-collision.ts(26,41): error TS2345: Property '_konfig_duplicate' is missing … "Duplicate App \\"api\\"…"`
  }
]

export const SNIPPETS = {
  apiModuleHead: {
    file: "infra/modules/api.ts",
    between: { startAt: "export const defineApi = Module.fixedNs({", endBefore: "const bound = Environment.bind({" }
  },
  apiModuleTail: {
    file: "infra/modules/api.ts",
    between: { startAt: "const workload = Workload.web({" }
  },
  prodEnv: {
    file: "infra/envs/prod.ts",
    between: { startAt: "export default AppOfApps.entrypoint(" }
  },
  envContract: {
    file: "shared/env-contracts/src/bundles.ts",
    between: { startAfter: "./secrets", endBefore: "// Strict subset" }
  },
  envSecrets: {
    file: "shared/env-contracts/src/secrets.ts",
    between: { startAfter: "@konfig.ts/env", endBefore: "export const s3Creds" }
  },
  envRuntimeImports: {
    file: "apps/api/src/main.ts",
    lines: [2, 3]
  },
  envRuntimeUse: {
    file: "apps/api/src/main.ts",
    between: { startAt: "const port = config.http.port", endBefore: "Bun.serve" }
  },
  envBind: {
    file: "infra/modules/api.ts",
    between: { startAfter: "const apiImage = yield*", endBefore: "const apiContainer" }
  }
} as const satisfies Record<string, SnippetSpec>

export const load = (spec: SnippetSpec): Snippet => loadSnippet(spec)
