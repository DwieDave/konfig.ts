# @konfig.ts/core

The Kubernetes-agnostic primitives that the rest of konfig.ts builds on:
the `Manifest<A>` carrier, the `Dep.*` kinds that drive compile-time
dependency tracking, a stable YAML serializer, structural diff, an Effect
`Schema` boundary helper, and the `Helm.release` integration.

Higher-level surfaces — workloads, services, env contracts, ArgoCD
Application aggregation — live in `@konfig.ts/k8s`, `@konfig.ts/env`,
and `@konfig.ts/argocd`.

## `Manifest<A>` — the carrier

A `Manifest<A>` is a thunk from a `RenderContext` to an Effect that
produces an `A`:

```ts
interface Manifest<A> {
  readonly render: (
    ctx: RenderContext,
  ) => Effect.Effect<A, AnyRenderError, RenderServices>;
}
```

`RenderServices` is `FileSystem | Path | ChildProcessSpawner | Scope`.
Errors are a tagged union: `RenderError`, `EmbedYamlReadError`,
`BoundaryDecodeError`, `HelmVersionTooLow`, `HelmRenderError`,
`HelmDigestMismatch`, `CrdExtractError`.

Constructors:

| Op | Behaviour |
|---|---|
| `Manifest.make(run)` | Lift a `ctx → A \| Effect<A>` into a Manifest. |
| `Manifest.combine({ a, b })` | Render `a` and `b` concurrently into a tuple. |
| `Manifest.concat(...ms)` | Flatten an array of Manifests into one. |
| `Manifest.whenever({ cond, thunk })` | Optional inclusion. |
| `Manifest.embedYaml(source)` | Pass through verbatim YAML (file or literal). |

The `Manifest<A>` itself is not where dependency-tracking happens — it
just carries data and effect failures. The compile-time graph lives
one level up; see below.

## Where the type-safety lives

konfig's dep-graph claim has two boundaries:

1. **`AppOfApps.entrypoint(program)`** in `@konfig.ts/argocd`. Every
   `Application.define({...})` produces an Effect `Layer.Layer<Out, _, In>`
   that propagates the `Dep.Provide<K, N>` it produces in `Out` and the
   `Dep.Need<K, N>` it consumes in `In`. Compose with `Layer.provideMerge`,
   pass to `entrypoint`, and TypeScript checks `In === never`. A missing
   provider is a compile error — see
   [`examples/full-stack/infra/envs/broken.ts`](../../examples/full-stack/infra/envs/broken.ts).

2. **`Environment.bind({ env, secrets })`** in `@konfig.ts/env`. The
   bundle's secret atoms describe `{ envName, secret, key }` triples; the
   `bind` checks at the type level that every secret has a backend, the
   backend's `keys` set matches the bundle's keys, and a `requiresSource`
   backend has a `source` of the right key shape.

Inside a single `Application.define({ build })` Effect, dep tracking is
declarative: when you `yield* Dep.Secret("ghcr-pull")` to obtain a
`SecretRef<"ghcr-pull">`, you add the `Need` to the requirements. Forget
to yield, and nothing complains — the system catches misses at
composition, not inside an Application's body.

## `Dep.*` — tracked kinds

```ts
import { Dep } from "@konfig.ts/core";
```

| Kind | Service | Provided value |
|---|---|---|
| `Dep.App<Name>(name)` | `Need<"App", Name>` | `Application` record |
| `Dep.Application<Name>(name)` | `Need<"Application", Name>` | `Name` literal |
| `Dep.Namespace<Name>(name)` | `Need<"Namespace", Name>` | `Name` literal |
| `Dep.Secret<Name>(name)` | `Need<"Secret", Name>` | `SecretRef<Name>` brand |
| `Dep.SecretValues<Name, K>(name)` | `Need<"SecretValues", Name>` | `{ readonly [k in K]: Redacted<string> }` |
| `Dep.ConfigMap<Name>(name)` | `Need<"ConfigMap", Name>` | `ConfigMapRef<Name>` brand |
| `Dep.ServiceAccount<Name>(name)` | `Need<"ServiceAccount", Name>` | `ServiceAccountRef<Name>` brand |
| `Dep.Pvc<Name>(name)` | `Need<"Pvc", Name>` | `PvcRef<Name>` brand |

For each kind there's a matching `provideX` helper (`provideSecret`,
`provideNamespace`, …) that emits a `Layer.Layer<Provide<K, N>>`.

`brand(value)` and `coerce(value)` from `@konfig.ts/core` are escape
hatches. `brand` is fine — it's a nominal-typing primitive for the `*Ref`
types. `coerce` is the unchecked cast; prefer the schema boundary below.

## Stable YAML — `Yaml.serialize({ value })`

Output rules:

- Top-level keys ordered: `apiVersion`, `kind`, `metadata`, `spec`,
  `status`, then alphabetical.
- Inside `metadata`: `name`, `namespace`, `labels`, `annotations`, then
  alphabetical.
- Every other map: alphabetical.
- Lists preserve insertion order.
- LF endings, 2-space indent, single trailing newline.
- YAML 1.1 explicit (kubectl/ArgoCD compatibility).

`Yaml.filenameFor(resource)` returns `<Kind>-<metadata.name>.yaml` —
deterministic per-resource filenames for ArgoCD-friendly diffs.

## Structural diff — `diffFiles({ left, right })`

Each file's YAML is parsed and redacted (Helm-volatile metadata stripped)
before deep-equality. Output is `Map<filename, FileDiff>`, formatted via
`formatDiff(result, "summary" | "detail" | "json")`. Today's diff is
two-way only and treats each file as a single document; richer per-doc
and anchor-aware diffing is on the roadmap.

## `Helm.release({...})`

Calls `helm pull` and `helm template`, lifts each emitted YAML document
as a `RawYaml` Manifest under the parent Application. SHA-256 of the
`.tgz` is verified against `opts.digest` after pull **and** on every
cache hit — flipping a byte in a cached tarball fails the next render
with `HelmDigestMismatch`.

`opts.digest` must include the `sha256:` prefix; the cache file name
includes the first 12 hex digits, but the verifier compares the full
hash.

## Boundary decode — `boundary({ schema, label })`

Wraps `Schema.decodeUnknownEffect` so that any decode failure becomes
a `BoundaryDecodeError` with `schema: label`. Use at the seams where
untyped input enters a module:

```ts
const decodeApiOptions = boundary({ schema: ApiOptions, label: "api" });
const cfg = yield* decodeApiOptions(input);
```

Every place that previously did `coerce<T>(YAML.parse(stdout))` over
untrusted external output is now expected to use this helper.

## Layout

```
src/
├── index.ts              barrel
├── _cast.ts              brand + coerce (escape hatch)
├── boundary.ts           Schema.decode wrapper → BoundaryDecodeError
├── deps.ts               Dep.* kinds + provide* helpers
├── diff.ts               structural diff + redaction
├── Helm.ts               Helm.release with digest verification
├── images.ts             ImagesConfig + decoders
├── konfigConfig.ts       KonfigConfig schema (top-level config)
├── Manifest.ts           Manifest interface + combinators
├── render.ts             render entrypoint
├── RenderContext.ts      threaded through every render
├── RenderError.ts        tagged error union
├── types.ts              Kind enum (legacy; superseded by Dep.*)
└── yaml/
    ├── index.ts
    └── serialize.ts      stable YAML serializer + filenameFor
```
