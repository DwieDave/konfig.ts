# T5.0 Spike — Typesafe asset/config management for `@konfig.ts/k8s`

**Verdict: pattern works.** No adjustments to T5.1–T5.9 required. Branded
refs are parameterized on the resource *name*, env/volume helpers carry
that name through to the Container/Pod/Deployment via parameterized
generics, and the final Deployment Manifest accumulates the names in
its `R` parameter automatically.

## Fixture

`infra/k8s/modules/oauth-proxy.nix` (539 LOC) was the test bed. Its
option shape exercises every relevant axis:

- A TLS secret reference (`tls.secretName`) — FR-4.4 enforcement point
  for Ingress `tls[].secretName`.
- An OAuth client-secret reference (`clientSecretSecretName` +
  `clientSecretKey`) wired into env via `secretEnv` — FR-4.4 point for
  `Container.env[].valueFrom.secretKeyRef.name`.
- A cookie-secret reference, same pattern.
- A ConfigMap mounted as a volume (`oauth-proxy-templates`) — FR-4.4
  point for `Pod.spec.volumes[].configMap.name`.
- An image-pull secret (`ghcr-pull-secret` via Sops embed) — FR-4.4
  point for `Pod.spec.imagePullSecrets[].name`.
- A lazy default for `oidcIssuerUrl` derived from `${host}` + `${realm}`.

## Pattern that works

```ts
// Branded ref carries the name in its type.
type SecretRef<N extends string = string> = string & { readonly [SecretRefBrand]: N };

// secretEnv carries the name through.
declare const secretEnv:
  <N extends string>(key: string, ref: SecretRef<N> & {key: string}) =>
    EnvVar<Single<"Secret", N>>;

// Container accumulates R from env (and volumes too).
interface ContainerInput<R extends Deps> {
  readonly name: string;
  readonly image: string;
  readonly env?: ReadonlyArray<EnvVar<R>>;
  readonly volumeMounts?: ReadonlyArray<VolumeMount>;
  // ... other fields untyped (loose Container shape)
}

// Deployment.make produces Manifest<Deployment, R, Empty>
declare const Deployment_make: <R extends Deps = Empty>(input: {
  metadata: { name: string; namespace: string; ... };
  spec: { template: { spec: { containers: ContainerInput<R>[]; ... } } };
}) => Manifest<Deployment, R, Empty>;
```

## Lazy defaults — resolved imperatively after Schema decode (per concept §5)

Schemas at the boundary don't try to express derived defaults. Inside
the module function (`oauthProxy(input)`):

```ts
const cfg = yield* boundary(OauthProxyOptions, "oauth-proxy")(input);
const issuerUrl =
  cfg.oidcIssuerUrl ?? `https://${cfg.host}/realms/${cfg.realm}`;
// build manifests with cfg + derived values …
```

This is plain TS, runs once, fully type-checked.

## Decisions baked into M5

- **`SecretRef<N>` is parameterized on the name.** Erased
  unparameterized `SecretRef` (the FR-4.4 erasure) is `SecretRef<string>`
  — still distinct from a bare `string`, so raw strings get rejected.
- **`kubernetes-types@1.30.0` is the source of truth** for the k8s
  resource interface shapes. M5's constructors define their own loose
  `Input<R>` types (with branded fields and an R parameter) but produce
  values that conform to the `kubernetes-types` interfaces at the
  rendered-output boundary.
- **R is accumulated through `env[]` and `volumes[]` arrays** via
  `UnionR<readonly EnvVar<infer R>[]>` mapped types. Each helper
  (`secretEnv`, `configMapEnv`) yields a typed value carrying its
  contribution to R; the surrounding arrays distribute the union.
- **`ServiceAccountRef` is loosened to `ServiceAccountRef | string`**
  per FR-4.4 — many ports reference cluster-default accounts.
