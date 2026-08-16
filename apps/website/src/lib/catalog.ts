import { loadSnippet, type Snippet, type SnippetSpec } from "./snippets"

/** Every code sample on the page, sourced from `examples/full-stack`. */

export interface FailureCase {
  readonly id: string
  readonly tab: string
  readonly title: string
  readonly summary: string
  readonly spec: SnippetSpec
  /** The abridged `tsc` line printed under the editor. */
  readonly tsc: string
}

const MISSING_PROVIDER =
  `Argument of type 'Effect<AppOfAppsResult, AnyRenderError, Need<"Image", "api"> | Need<"Image", "worker"> | Need<"Secret", "ghcr-pull"> | RenderServices>' is not assignable to parameter of type 'Effect<…> & { readonly _konfig_unsatisfied: … }'.
  Property '_konfig_unsatisfied' is missing but required in type
  '{ readonly _konfig_unsatisfied: "Missing provider for Secret \\"ghcr-pull\\". Add a module that provides it to AppOfApps.fromModules({ modules }), or check that providers come before consumers in the list." | … }'.`

export const FAILURE_CASES: ReadonlyArray<FailureCase> = [
  {
    id: "missing-provider",
    tab: "broken.ts",
    title: "A module needs a Secret nobody provides",
    summary:
      "`api` does `yield* Dep.Secret(\"ghcr-pull\")` in its build. Leave the `imagePulls` module out of the list and `entrypoint` refuses to compile.",
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
    tsc: `infra/envs/broken.ts(30,3): error TS2345: Property '_konfig_unsatisfied' is missing … "Missing provider for Secret \\"ghcr-pull\\"…"`
  },
  {
    id: "unbound-secret",
    tab: "unbound-secret.ts",
    title: "An env contract with a secret you forgot to bind",
    summary:
      "`apiEnv` declares three secret members. `Environment.bind` demands a backend for each one — and a `source` when the backend's type says it needs one.",
    spec: {
      file: "infra/envs/unbound-secret.ts",
      stripMeta: true,
      between: { startAfter: "void _missingSecretsField", endBefore: "void _missingSource" },
      diagnostics: [
        {
          on: "  secrets: {",
          find: "secrets",
          code: "2741",
          message:
            `Property 'jwt' is missing in type '{ db: { backend: SecretBackend<…> }; s3: { backend: SecretBackend<…> }; }' but required in type 'SecretMembersOpts<{ readonly db: SecretEntry<"db-creds", …>; readonly s3: SecretEntry<…>; readonly jwt: SecretEntry<…>; … }>'.`
        },
        {
          on: "    db: {},",
          find: "db: {}",
          code: "2322",
          message: `Type '{}' is not assignable to type 'SecretMemberOptions<"db-creds", "password" | "url" | "username">'.`
        },
        {
          on: "    db: { backend: sopsBackend },",
          find: "db: { backend: sopsBackend }",
          code: "2322",
          message:
            `Type '{ backend: SecretBackend<string, string, true, …> }' is not assignable to type 'SecretMemberOptions<"db-creds", …>'.
  Property 'source' is missing but required in type '_SecretMemberBackendRequiresSource<"db-creds", "password" | "url" | "username">'.`
        }
      ]
    },
    tsc: `infra/envs/unbound-secret.ts(39,3): error TS2741: Property 'jwt' is missing in type '{ db: …; s3: … }' but required in type 'SecretMembersOpts<…>'.`
  },
  {
    id: "widened-name",
    tab: "widened-name.ts",
    title: "An Application name that isn't a literal",
    summary:
      "Names flow into the dep graph as string literals. Widen one to `string` and the graph can't reason about it — so the call site rejects it.",
    spec: {
      file: "infra/envs/widened-name.ts",
      stripMeta: true,
      between: { startAfter: "void _ok", endBefore: "void _widened" },
      diagnostics: [
        {
          find: "name: dynamicName",
          code: "2322",
          message:
            `Type 'string' is not assignable to type '{ readonly _konfig_error: "Module name/namespace must be a string literal. Make the wrapper generic (\`<const Name extends string>\`) and forward via \`Module.LiteralName<Name>\`."; }'.`
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
      "`Environment.define` checks env names across every member — literals, secrets, downward — at the type level. A collision is an error on the call.",
    spec: {
      file: "infra/envs/envname-collision.ts",
      stripMeta: true,
      between: { startAfter: "void _literalDup", endBefore: "void _secretLiteralDup" },
      diagnostics: [
        {
          find: "Environment.define({",
          code: "2345",
          message:
            `Argument of type '{ db: SecretEntry<"db", "url", { readonly url: "DATABASE_URL"; }>; shadow: LiteralEntry<"DATABASE_URL", string>; }' is not assignable to parameter of type '{ … } & _EnvNameCollisionError<"DATABASE_URL">'.
  Property '_konfig_error' is missing but required in type '_EnvNameCollisionError<"DATABASE_URL">'.`
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
          message:
            `Property '_konfig_duplicate' is missing in type '{ target: …; defaults: {}; modules: readonly [ApplicationHandle<"api", …>, ApplicationHandle<"api", …>]; }' but required in type '{ readonly _konfig_duplicate: "Duplicate App \\"api\\": two modules in AppOfApps.fromModules({ modules }) provide the same name; the later one silently shadows the earlier. Rename one of them."; }'.`
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
  envRuntime: {
    file: "apps/api/src/main.ts",
    lines: [2, 22]
  },
  envBind: {
    file: "infra/modules/api.ts",
    between: { startAfter: "const apiImage = yield*", endBefore: "const apiContainer" }
  }
} as const satisfies Record<string, SnippetSpec>

export const load = (spec: SnippetSpec): Snippet => loadSnippet(spec)
