/**
 * `Module.*` is the wrapper-factory layer on top of `Application.define`
 * (argocd) and `Bundle.define` (k8s). One call site, one set of
 * generics, two backend targets.
 *
 *  - `Module.fixedNs({ target, namespace, build })` — namespace baked
 *    into wrapper identity (e.g. cert-manager always lives in
 *    `cert-manager`).
 *  - `Module.dynamicNs({ target, build })` — namespace chosen per
 *    instance (e.g. an `api` module shipped into per-env namespaces).
 *
 * Each backend exports a `target` adapter (e.g. `Application.target`,
 * `Bundle.target`) that pins the handle kind and the extra config- /
 * call-time fields the backend requires (`syncPolicy`/`source` for
 * argocd, none for bundle). Pass it as `target` in the config;
 * TypeScript infers the rest.
 *
 * Provides + Needs flow exactly as they do for the underlying
 * `define` — Module is purely a typing/ergonomic layer.
 */
import { Application } from "@konfig.ts/argocd"
import { Bundle, Dep, Module } from "@konfig.ts/core"
import { Effect } from "effect"

const argoSrc = (path: string): Application.ArgoSource => ({
  repoURL: "ssh://git@github.com/example/infra.git",
  targetRevision: "main",
  path
})

// ── argocd target ────────────────────────────────────────
// Fixed namespace ("auth"), provides a Secret consumers can reference.
const defineAuth = Module.fixedNs({
  target: Application.target,
  namespace: "auth",
  provides: Dep.provideSecret("oidc-issuer"),
  build: ({ name, namespace }, _opts: Record<never, never>) => [
    { kind: "Secret", name, namespace }
  ]
})

// Dynamic namespace — `api` lives in different namespaces per env.
const defineApi = Module.dynamicNs({
  target: Application.target,
  build: ({ name, namespace }, opts: { readonly image: string }) =>
    Effect.gen(function*() {
      const issuer = yield* Dep.Secret("oidc-issuer")
      return [
        {
          kind: "Deployment",
          name,
          namespace,
          image: opts.image,
          env: [{ name: "OIDC_ISSUER_SECRET", value: issuer }]
        }
      ]
    })
})

const auth = defineAuth({ name: "auth-secrets", source: argoSrc("./apps/auth") })
const api = defineApi({
  name: "api",
  namespace: "prod",
  source: argoSrc("./apps/api"),
  image: "ghcr.io/example/api:1.0"
})

void auth
void api

// ── bundle target ────────────────────────────────────────
// No git source, no syncPolicy — Bundle is the argo-agnostic backend.
const defineCertManager = Module.fixedNs({
  target: Bundle.target,
  namespace: "cert-manager",
  build: ({ name, namespace }, opts: { readonly version: string }) => [
    { kind: "Namespace", name: namespace },
    { kind: "HelmRelease", name, namespace, chart: "cert-manager", version: opts.version }
  ]
})

const certManager = defineCertManager({ name: "cert-manager", version: "v1.14" })
void certManager
