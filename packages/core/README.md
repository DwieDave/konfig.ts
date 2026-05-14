# @konfig.ts/core

Typesafe Kubernetes manifest primitives — the type algebra and YAML
serialization layer that `@konfig.ts/k8s` and `@konfig.ts/argocd` build on.

## Surface

### `Manifest<A, R, P>`

The unit of composition. `A` is the produced value, `R` is the per-kind
set of named resources the manifest **requires**, `P` is the set it
**provides**. Tracked kinds: `Secret`, `ConfigMap`, `Namespace`,
`ServiceAccount`, `Application`.

```ts
import { Manifest, render, RenderContext } from "@konfig.ts/core";

const m = Manifest.embedYaml(
  { literal: "apiVersion: v1\nkind: Secret\n..." },
  { Secret: "shared-secret" as const },
);

// `render` only accepts Manifest<A, Empty, P> — undischarged Rs fail to
// compile.
await Effect.runPromise(render(m, RenderContext.make("prod")));
```

Operators (all in the `Manifest` namespace):

| Op | Behavior |
|---|---|
| `make(run)` | Low-level constructor — most code uses higher-level ops. |
| `combine(a, b)` | Union R/P and subtract one side from the other. |
| `assume(kind, name)(m)` | Type-level discharge of one requirement. |
| `provide(kind, name)(m)` | Type-level addition to a manifest's `P`. |
| `whenever(cond, thunk)` | Conditional inclusion (the `mkIf` analogue). |
| `embedYaml(source, P)` | Pass through verbatim YAML (file or literal). |

### Type algebra

| Type | Meaning |
|---|---|
| `Kind` | The five tracked kinds. |
| `Deps` | Per-kind record of name unions. |
| `Empty` | Unit element — `never` for every kind. |
| `Subtract<R, P>` | Per-kind `Exclude<R[K], P[K]>`. |
| `Combine<R1, P1, R2, P2>` | `{ R: Subtract<R1∪R2, P1∪P2>; P: P1∪P2 }`. |
| `Single<K, N>` | A `Deps` with `N` only on kind `K`. |

### Stable YAML — `Yaml.serialize(value)`

Output rules (FR-2):

- Top-level keys ordered: `apiVersion`, `kind`, `metadata`, `spec`,
  `status`, then alphabetical.
- `metadata` keys (top-level only): `name`, `namespace`, `labels`,
  `annotations`, then alphabetical.
- All other map keys: alphabetical.
- Lists preserve insertion order.
- LF endings, 2-space indent, single trailing newline.

`Yaml.filenameFor(resource)` returns `<Kind>-<metadata.name>.yaml`.

### Structural diff — `diffFiles(left, right)`

Compares two `{ filename: yaml-text }` maps. Each file is parsed and
redacted (helm-emitted volatility stripped per FR-3.2) before deep
equality. Maps compare key-set-and-value (order-insensitive); lists
compare positionally.

Output formatters: `formatDiff(result, "summary" | "detail" | "json")`.

### Schema boundary — `boundary(schema)`

Wraps `Schema.decodeUnknownEffect` to produce a tagged
`BoundaryDecodeError` instead of the raw `SchemaError`. Use at the
seams where untyped input enters a module:

```ts
const cfg = yield* boundary(ApiOptions, "api")(input);
```

## Layout

```
src/
├── index.ts              barrel
├── types.ts              Kind, Deps, Empty, Subtract, Combine
├── Manifest.ts           Manifest interface + combine/assume/provide/whenever/embedYaml
├── render.ts             render entrypoint (gated on R=Empty)
├── RenderContext.ts      threaded through every render
├── RenderError.ts        RenderError + EmbedYamlReadError + BoundaryDecodeError
├── boundary.ts           Schema.decode wrapper
├── diff.ts               structural diff + redaction
└── yaml/
    ├── index.ts
    └── serialize.ts      stable YAML serializer + filenameFor
```

## Status

M2 of the `konfig-typesafe-k8s` workflow. Constructors for real Kubernetes
resources land in `@konfig.ts/k8s` (M5); ArgoCD `Application` aggregation lands
in `@konfig.ts/argocd` (M3); CLI in `@konfig.ts/cli` (M4+).
