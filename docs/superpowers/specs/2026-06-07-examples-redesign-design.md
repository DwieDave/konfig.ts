# Examples redesign — a flagship for skimmers, recipes underneath

## Why

The current `examples/` tree is eight numbered files plus a `full-stack/`
monorepo. The numbered files are organized by API surface ("branded
refs", "env bound", "bundle deps") rather than by problem. Each repeats
the same `NodeRuntime.runMain` + `Effect.scoped` + `Effect.provide(NodeServices.layer)`
+ `RenderContext.make` boilerplate. Headline pitches from the README —
Helm digest verification, dep-graph at compile time, env contracts as
one source of truth — are scattered across the files or absent. A
skimmer evaluating the library opens one of the numbered files, sees
ten lines of Effect wiring, three `@ts-expect-error` snippets interleaved
with happy-path code, and bails before any pitch lands.

The audience to optimise for is the **skimmer evaluating the library** —
someone with five to ten minutes who is deciding whether konfig.ts is
worth a closer look. The success criterion is: open one file, read
top-to-bottom, walk away with two mental hooks for what makes konfig.ts
different.

## Shape

A single flagship file at the top of `examples/`. Two acts. One
runner. The existing numbered files become focused recipes underneath.
A new top-level `render()` function in `@konfig.ts/core` removes the
Effect-runtime boilerplate from every example and from every user's own
entrypoint.

### Tree

```
examples/
├── start-here.ts          ← NEW: flagship, two acts in ~85 lines
├── recipes/               ← NEW: home for the existing demos
│   ├── README.md          ← index, grouped by problem
│   ├── branded-refs.ts             ← was 01
│   ├── images-config.ts            ← was 03
│   ├── env-runtime-decode.ts       ← was 04
│   ├── secret-backend-native.ts    ← was 05
│   ├── secret-backend-external.ts  ← was 06
│   ├── restart-on-rotation.ts      ← was 07
│   ├── app-of-apps-deps.ts         ← was 02
│   ├── bundle-deps.ts              ← was 08
│   └── helm-digest-verify.ts       ← NEW: covers the README pitch the flagship skips
├── full-stack/            ← unchanged
├── package.json           ← `start-here` script promoted; recipes namespaced
└── tsconfig.json          ← include glob expanded to cover recipes/
```

Numbered prefixes drop because the order didn't carry meaning. Each
recipe is named for the problem it solves, not the namespace it
exercises.

## The flagship — `examples/start-here.ts`

Target: ~85 lines. Two acts separated by a banner comment. One
`render(...)` call at the bottom. The file types and runs.

### Act 1 — the dep graph is type-checked (~30 lines)

Two bundles. `image-pulls` provides `Secret("ghcr-pull")`. `api` needs
it. `Bundle.fromModules({ modules: [imagePulls, api] })` composes;
`Bundle.entrypoint` accepts. Immediately below, the broken variant:

```ts
const broken = Bundle.fromModules({ modules: [api] as const });
// @ts-expect-error  Need<"Secret", "ghcr-pull"> is not assignable to RenderServices
Bundle.entrypoint(broken);
```

The reader sees both shapes side by side. The punchline is the banner
comment above the act: *"removing the provider is a TypeScript error,
not a Sunday-morning incident."*

Bundle is chosen over AppOfApps because it's argo-agnostic — the
dep-graph check works whether or not the reader uses ArgoCD.

### Act 2 — the env contract is one source of truth (~40 lines)

One `Secret.define` and one `Literal.define` flow into
`Environment.define` → `Environment.bind` → the same atom feeds the
`Workload.web` container env block. At the bottom of the act,
`yield* apiEnv` decodes the same atom from `process.env` — mocked via a
`ConfigProvider` layer so the example runs without a real environment.

The reader sees `dbCreds` referenced from both the manifest
construction and the runtime read. The Deployment YAML for the env
block prints. The runtime values print (`port = 8080`,
`db.url = <redacted>`). The visual repetition of one variable name
across both sides is the punchline.

### Closing

The whole runner collapses to:

```ts
const fakeProcessEnv = Layer.setConfigProvider(
  ConfigProvider.fromUnknown({
    DATABASE_URL: "postgres://localhost/api",
    PORT: "8080",
  }),
);

render((ctx) => program(ctx), { layers: fakeProcessEnv });
```

### Out of scope for the flagship

Three powers stay out so the skim budget holds:

- **Helm digest verification** — front-page README pitch but a third
  act blows the budget. Moves to a new
  `recipes/helm-digest-verify.ts`.
- **Backend swap** — strong pitch but a third act. Already covered by
  `recipes/secret-backend-native.ts` + `secret-backend-external.ts`.
- **Multi-env rendering** — already in `full-stack`. Flagship stays
  single-env.

## The new core API — `render`

Every user writes the same wiring code to call into a render pipeline.
Promoting it to `@konfig.ts/core` means no user has to learn Effect's
runtime to ship manifests, and every example in the repo can drop the
boilerplate uniformly.

### Signature

```ts
// packages/core/src/render.ts
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { RenderContext } from "./RenderContext";

export const render = <E, R>(
  program: (ctx: RenderContext) => Effect.Effect<void, E, R | NodeServices>,
  options: { env?: string; layers?: Layer.Layer<R, never, never> } = {},
): void => {
  const ctx = RenderContext.make(options.env ?? "prod");
  const base = NodeServices.layer;
  const layers = options.layers ? Layer.mergeAll(base, options.layers) : base;
  NodeRuntime.runMain(program(ctx).pipe(Effect.scoped, Effect.provide(layers)));
};
```

Exported as a top-level value from `@konfig.ts/core`, not namespaced.
Reads as `render((ctx) => program(ctx))`. Closure form covers both
"needs ctx" and "doesn't need ctx" without polymorphism. Default
`env` is `"prod"` so the common case is a one-liner.

### Package boundary

`render` imports `NodeServices` from `@effect/platform-node`. At
implementation time, verify whether `@konfig.ts/core` already depends on
`@effect/platform-node` (the CLI render path almost certainly does). If
core is meant to stay platform-agnostic, the fallback home is
`@konfig.ts/k8s`, which is the package every workload example imports
anyway. Implementation chooses based on the existing dep graph, not on
a fresh dependency.

### Ripple effects

- All eight existing recipes migrate to `render(...)` as part of the
  same change, and the new `helm-digest-verify.ts` is written against
  it from the start. Otherwise the codebase ships two boilerplate
  styles.
- `examples/full-stack/` is audited for the same boilerplate and
  migrated where it appears.
- New entry in `docs/public-api.md` for `render`.
- New line in `CHANGELOG.md`: `feat(core): top-level render() entrypoint`.
- README's "60-second tour" snippets are re-checked for direct
  `NodeRuntime.runMain` references; updated to `render(...)` where the
  swap clarifies the example.

## The recipes index — `examples/recipes/README.md`

A short markdown index, grouped by problem. No tables of contents per
file; recipes are short enough to skim directly.

```markdown
# Recipes

Focused per-feature snippets. Start with `../start-here.ts` for the
tour; come here when you need the answer to one specific question.

## Composition
- `bundle-deps.ts` — compose Bundles, catch missing providers at compile time
- `app-of-apps-deps.ts` — same idea on the ArgoCD side

## Env contracts
- `env-runtime-decode.ts` — read a Secret atom at process startup
- `secret-backend-native.ts` — emit a plain Kubernetes Secret
- `secret-backend-external.ts` — emit an ExternalSecret CR
- `restart-on-rotation.ts` — pod restart pinned to Secret values

## Charts
- `helm-digest-verify.ts` — `Helm.release` rejects a chart whose cached `.tgz` doesn't match the pinned digest

## Types
- `branded-refs.ts` — SecretRef<N, K> rejects wrong names and wrong keys
- `images-config.ts` — typed images.json loader with per-env lookup
```

## Repo-root README

The Quickstart section gets a one-sentence redirect:

> Start with `examples/start-here.ts` for the 90-second tour. See
> `examples/recipes/` for focused per-feature snippets. See
> `examples/full-stack` for a complete monorepo with env contracts,
> SOPS, Helm, and ArgoCD wiring.

Existing prose under "What you get", "Packages", and "What this is
*not*" stays. The "60-second tour" code blocks are re-checked for
`NodeRuntime.runMain` references; any update is cosmetic.

## Package metadata

`examples/package.json`:

- `start-here`: top-level script, the default a reader copy-pastes.
- `recipes:branded-refs`, `recipes:bundle-deps`, etc.: namespaced
  scripts for each recipe.
- `check`: unchanged.

`examples/tsconfig.json` `include` glob expands from `./*.ts` to
`["./*.ts", "./recipes/*.ts"]` so the recipes typecheck under the same
config as before.

## Non-goals

- No re-org of `examples/full-stack/`. It's already the deep dive and
  its README points at the right pieces.
- No new docs writing for `RenderContext`, `Bundle`, or
  `Environment` — those have homes in `docs/public-api.md` and
  `docs/architecture.md`. The redesign only touches the `render` entry.
- No promotion of `render` to a generic "run any Effect" helper. It's
  scoped to programs that take a `RenderContext` and produce manifest
  side effects.
