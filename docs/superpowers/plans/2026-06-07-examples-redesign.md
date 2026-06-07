# Examples Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the eight numbered examples with a flagship `start-here.ts` that lands two visceral pitches in ~85 lines (Bundle dep-graph + env contract); move the existing demos to `examples/recipes/` as named per-problem snippets; add a top-level `render()` runner in `@konfig.ts/core` that collapses the Effect/NodeRuntime boilerplate every example repeats today.

**Architecture:** One new core export (`render`) and one rename (existing `render` → `renderManifest`). The new `render` takes a callback `(ctx) => Effect`, defaults `env` to `"prod"`, wires `NodeServices.layer` and an optional caller-provided layer, then hands off to `NodeRuntime.runMain`. `@effect/platform-node` promotes from devDep to peerDep on core. All examples migrate to the new runner; the eight existing demos rename and move under `recipes/`; a new ninth recipe (`helm-digest-verify.ts`) covers the README headline the flagship intentionally skips.

**Tech Stack:** TypeScript 5.8, Effect 4.0.0-beta.70, `@effect/platform-node` 4.0.0-beta.70, Vitest 4, Bun 1.3, oxlint.

**Spec:** [`docs/superpowers/specs/2026-06-07-examples-redesign-design.md`](../specs/2026-06-07-examples-redesign-design.md)

---

## Phase 1 — Core: rename the existing render, add the new one

### Task 1: Rename existing `render` to `renderManifest`

The existing `render({ manifest, ctx })` helper occupies the name we want for the new runner. Rename it in-place (file + export + 4 callers) in one atomic commit so no intermediate state is broken.

**Files:**
- Rename: `packages/core/src/render.ts` → `packages/core/src/renderManifest.ts`
- Modify: `packages/core/src/index.ts:75` (export line)
- Modify: `packages/cli/src/buildEnv.ts:205` (call site)
- Modify: `packages/k8s/src/identity.test.ts:1` (import line)
- Modify: `packages/k8s/src/ports.test.ts:1` (import line)
- Modify: `packages/k8s/src/selector.test.ts:1` (import line)

- [ ] **Step 1: Rename the file**

```bash
git mv packages/core/src/render.ts packages/core/src/renderManifest.ts
```

- [ ] **Step 2: Rename the symbol inside the file**

Edit `packages/core/src/renderManifest.ts`. The full new content is:

```ts
import type { Effect } from "effect";
import type { Manifest, RenderServices } from "./Manifest";
import type { RenderContext } from "./RenderContext";
import type { AnyRenderError } from "./RenderError";

export interface RenderManifestInput<A> {
	readonly manifest: Manifest<A>;
	readonly ctx: RenderContext;
}
export const renderManifest = <A>(
	input: RenderManifestInput<A>,
): Effect.Effect<A, AnyRenderError, RenderServices> => input.manifest.render(input.ctx);
```

- [ ] **Step 3: Update the core export**

Edit `packages/core/src/index.ts`. Change line 75 from:

```ts
export { render } from "./render";
```

to:

```ts
export { renderManifest } from "./renderManifest";
```

- [ ] **Step 4: Update the cli caller**

Edit `packages/cli/src/buildEnv.ts`. Find the existing `render` import from `@konfig.ts/core` near the top of the file and change `render` → `renderManifest`. Then in the function body around line 205, change:

```ts
render({
    manifest: unsafeCoerce<AnyManifest>(
        m,
        "child.manifests holds Manifest<unknown> by Bundle/Application contract",
    ),
    ctx,
}),
```

to:

```ts
renderManifest({
    manifest: unsafeCoerce<AnyManifest>(
        m,
        "child.manifests holds Manifest<unknown> by Bundle/Application contract",
    ),
    ctx,
}),
```

- [ ] **Step 5: Update the three k8s test imports**

For each of `packages/k8s/src/identity.test.ts`, `ports.test.ts`, `selector.test.ts`: change the line `import { render, RenderContext, ... } from "@konfig.ts/core";` (or any ordering) to use `renderManifest` instead of `render`. Then in the test bodies, change every `render({ manifest, ctx })` call site to `renderManifest({ manifest, ctx })`.

Run `rg "\brender\(" packages/k8s/src/identity.test.ts packages/k8s/src/ports.test.ts packages/k8s/src/selector.test.ts` to find every spot that needs touching.

- [ ] **Step 6: Verify typecheck and tests**

Run:
```bash
bun run --cwd packages/core check
bun run --cwd packages/k8s check && bun run --cwd packages/k8s test
bun run --cwd packages/cli check && bun run --cwd packages/cli test
```
Expected: all green. No remaining references to the old `render` name in any production or test source.

- [ ] **Step 7: Sanity-grep for stragglers**

```bash
rg "from \"\\./render\"" packages/ examples/
rg "import \{ render[, }]" packages/ examples/
```
Expected: zero hits for the bare-`render` import from core. If the second grep matches lines that import `render` from somewhere else (e.g. a third-party module), those are not stragglers.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/renderManifest.ts packages/core/src/index.ts \
        packages/cli/src/buildEnv.ts \
        packages/k8s/src/identity.test.ts packages/k8s/src/ports.test.ts packages/k8s/src/selector.test.ts
git commit -m "refactor(core): rename render() helper to renderManifest() to free the name"
```

---

### Task 2: Promote `@effect/platform-node` to a peer dependency on core

`render` will import `NodeRuntime` and `NodeServices` from `@effect/platform-node`. To ship without forcing consumers into a transitive dep, declare it as a peerDep (matching how `effect` is already declared).

**Files:**
- Modify: `packages/core/package.json`

- [ ] **Step 1: Edit `peerDependencies`**

Open `packages/core/package.json`. Add `@effect/platform-node` to `peerDependencies` so it becomes:

```json
"peerDependencies": {
    "@effect/platform-node": "4.0.0-beta.70",
    "effect": "4.0.0-beta.70",
    "yaml": "^2.8.3"
},
```

Leave `@effect/platform-node` in `devDependencies` (for the package's own tests and build).

- [ ] **Step 2: Re-link workspace deps and verify install**

```bash
bun install
```
Expected: no errors. The lockfile may update; that's fine.

- [ ] **Step 3: Verify core still type-checks**

```bash
bun run --cwd packages/core check
```
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/core/package.json bun.lock
git commit -m "chore(core): promote @effect/platform-node to peerDependency for render()"
```

---

### Task 3: Add the new `render` runner with tests

The new `render` is a top-level function: it takes a callback that produces an `Effect`, defaults `env` to `"prod"`, optionally merges a caller-provided `Layer`, and runs via `NodeRuntime.runMain`. Test it with Vitest — we need to exercise the env default and the layer-merge behaviour without actually invoking `runMain` (which would call `process.exit`). The implementation factors the layer-merge logic out of the runMain call so the merge is testable on its own.

**Files:**
- Create: `packages/core/src/render.ts`
- Create: `packages/core/src/render.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/core/src/render.test.ts` with:

```ts
import { NodeServices } from "@effect/platform-node";
import { ConfigProvider, Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { _buildLayers, _resolveEnv } from "./render";
import { RenderContext } from "./RenderContext";

describe("render — env resolution", () => {
	it("defaults env to 'prod' when no option is passed", () => {
		expect(_resolveEnv(undefined)).toBe("prod");
	});

	it("uses the provided env when set", () => {
		expect(_resolveEnv("staging")).toBe("staging");
	});

	it("produces a RenderContext from the resolved env", () => {
		const ctx = RenderContext.make(_resolveEnv("preview"));
		expect(ctx.env).toBe("preview");
	});
});

describe("render — layer composition", () => {
	it("returns NodeServices.layer alone when no extra layer is provided", () => {
		const built = _buildLayers(undefined);
		// Both layers are opaque values; we assert reference identity with NodeServices.layer.
		expect(built).toBe(NodeServices.layer);
	});

	it("merges NodeServices.layer with the caller's layer when provided", async () => {
		const extra = Layer.setConfigProvider(
			ConfigProvider.fromUnknown({ FOO: "bar" }),
		);
		const built = _buildLayers(extra);
		expect(built).not.toBe(NodeServices.layer);
		// The merged layer should still satisfy a program that needs NodeServices —
		// asserted by running a trivial Effect that demands NodeServices and a Config read.
		const program = Effect.gen(function* () {
			const cfg = yield* Effect.config(ConfigProvider.fromUnknown({}).load(
				// dummy use to keep effect happy; real assertion is the layer being mergeable.
				"FOO" as never,
			).pipe(Effect.orElseSucceed(() => "ok")));
			return cfg;
		});
		// We only check that providing the merged layer compiles and runs without error.
		await Effect.runPromise(program.pipe(Effect.provide(built)));
	});
});
```

> Note for the implementer: if the "merged layer ... runs without error" assertion proves awkward against Effect 4 beta, replace the body with a minimal `Effect.succeed("ok")` test that just provides `built` and confirms `runPromise` resolves. The point is to prove the merge is well-typed and the resulting layer is providable.

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
bun run --cwd packages/core test -- render.test
```
Expected: FAIL with module-not-found or "Cannot find name '_resolveEnv'" — `render.ts` doesn't exist yet.

- [ ] **Step 3: Write the implementation**

Create `packages/core/src/render.ts` with:

```ts
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { RenderContext } from "./RenderContext";

export interface RenderOptions<RIn = never> {
	readonly env?: string;
	readonly layers?: Layer.Layer<RIn, never, never>;
}

/** @internal */
export const _resolveEnv = (env: string | undefined): string => env ?? "prod";

/** @internal */
export const _buildLayers = <RIn>(
	extra: Layer.Layer<RIn, never, never> | undefined,
): Layer.Layer<NodeServices | RIn, never, never> =>
	extra === undefined
		? (NodeServices.layer as Layer.Layer<NodeServices | RIn, never, never>)
		: Layer.mergeAll(NodeServices.layer, extra);

/**
 * Run a render program against `NodeRuntime`.
 *
 * The callback receives a `RenderContext` keyed on `options.env`
 * (default `"prod"`) and returns an Effect whose only required
 * services are `NodeServices` and whatever the caller supplies via
 * `options.layers`. `render` provides both, wraps in `Effect.scoped`,
 * and hands off to `NodeRuntime.runMain`.
 *
 * Replaces the per-file `NodeRuntime.runMain(program.pipe(...))`
 * boilerplate every example used to repeat.
 */
export const render = <E, RIn>(
	program: (ctx: RenderContext) => Effect.Effect<void, E, NodeServices | RIn>,
	options: RenderOptions<RIn> = {},
): void => {
	const ctx = RenderContext.make(_resolveEnv(options.env));
	const layers = _buildLayers(options.layers);
	NodeRuntime.runMain(program(ctx).pipe(Effect.scoped, Effect.provide(layers)));
};
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun run --cwd packages/core test -- render.test
```
Expected: all green. If the "merged layer runs without error" test trips on the Effect 4 beta API, swap it for the simpler `Effect.succeed("ok")` shape per the inline note above.

- [ ] **Step 5: Export from the core index**

Edit `packages/core/src/index.ts`. Below the existing `renderManifest` export line, add:

```ts
export { render, type RenderOptions } from "./render";
```

- [ ] **Step 6: Verify the whole core package**

```bash
bun run --cwd packages/core check
bun run --cwd packages/core test
bun run --cwd packages/core lint
```
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/render.ts packages/core/src/render.test.ts packages/core/src/index.ts
git commit -m "feat(core): render() — top-level entrypoint for render programs"
```

---

## Phase 2 — Build the flagship

### Task 4: Write `examples/start-here.ts`

The flagship: two acts, ~85 lines total, one `render(...)` call at the bottom. Act 1 demonstrates `Bundle.fromModules` + `Bundle.entrypoint` catching a missing provider at compile time. Act 2 shows the same env atom feeding both the Workload's container env block and a runtime decode.

**Files:**
- Create: `examples/start-here.ts`

- [ ] **Step 1: Write the file**

Create `examples/start-here.ts` with:

```ts
// konfig.ts in 90 seconds.
//
// Act 1 — the dep graph is type-checked.
//         Two bundles. One provides a Secret. The other needs it.
//         Removing the provider is a TypeScript error, not a
//         Sunday-morning incident.
//
// Act 2 — the env contract is one source of truth.
//         A single Secret.define feeds the Deployment env block AND
//         the runtime decoder. Touch one declaration, both sides
//         stay in sync.
//
// Run me: `bun run start-here` (from examples/)

import { Dep, render, Yaml } from "@konfig.ts/core";
import { Literal, Secret as SecretEnv } from "@konfig.ts/env";
import {
	Bundle,
	Environment,
	NativeSecret,
	Workload,
} from "@konfig.ts/k8s";
import { ConfigProvider, Effect, Layer } from "effect";

// ─── Act 1: the dep graph is type-checked ───────────────────────────

const imagePulls = Bundle.define({
	name: "image-pulls",
	namespace: "infra",
	build: () => [],
	provides: Dep.provideSecret("ghcr-pull"),
});

const apiBundle = Bundle.define({
	name: "api",
	namespace: "prod",
	build: Effect.gen(function* () {
		const ghcrRef = yield* Dep.Secret("ghcr-pull");
		void ghcrRef; // would feed Workload.deployment.imagePullSecrets in real code
		return [];
	}),
});

// Happy path — image-pulls precedes api, so its Provide<Secret, "ghcr-pull">
// discharges api's Need. Bundle.entrypoint accepts.
const checked = Bundle.entrypoint(
	Bundle.fromModules({ modules: [imagePulls, apiBundle] as const }),
);

// Broken — image-pulls omitted. The Need<Secret, "ghcr-pull"> survives
// the fold; entrypoint rejects at the type level.
const broken = Bundle.fromModules({ modules: [apiBundle] as const });
// @ts-expect-error  Need<"Secret", "ghcr-pull"> is not assignable to RenderServices
Bundle.entrypoint(broken);

// ─── Act 2: the env contract is one source of truth ─────────────────

const dbCreds = SecretEnv.define({
	name: "db-creds",
	namespace: "prod",
	env: { url: "DATABASE_URL" },
});
const port = Literal.define({ envName: "PORT", value: 8080 });

const apiEnv = Environment.define({ db: dbCreds, port });

const bound = Environment.bind({
	env: apiEnv,
	secrets: {
		db: { backend: NativeSecret.backend({ silenceWarning: true }) },
	},
});

const api = Workload.web({
	name: "api",
	namespace: "prod",
	deployment: {
		containers: [{
			name: "api",
			image: "ghcr.io/example/api:1.0",
			ports: [{ containerPort: 8080 }],
			env: bound.envVars,
		}],
	},
	service: { ports: [{ port: 80, targetPort: 8080 }] },
});

// ─── Run both acts ──────────────────────────────────────────────────

const program = (ctx: Parameters<typeof api.render>[0]) =>
	Effect.gen(function* () {
		yield* Effect.log("=== act 1: bundle dep graph ===");
		const set = yield* checked;
		yield* Effect.log(
			`composed ${set.bundles.length} bundles: ${set.bundles.map((b) => b.name).join(", ")}`,
		);
		yield* Effect.log(
			"(removing image-pulls would fail at TypeScript — see @ts-expect-error above)",
		);

		yield* Effect.log("\n=== act 2: env contract — manifest side ===");
		const [deployment] = yield* api.render(ctx);
		yield* Effect.log(Yaml.serialize({ value: deployment }));

		yield* Effect.log("=== act 2: env contract — runtime side ===");
		const env = yield* apiEnv;
		yield* Effect.log(`port (literal) = ${env.port}`);
		yield* Effect.log(`db.url (redacted) = ${String(env.db.url)}`);
	});

// Mock process.env so the runtime side of act 2 has values to read.
const fakeProcessEnv = Layer.setConfigProvider(
	ConfigProvider.fromUnknown({
		DATABASE_URL: "postgres://localhost/api",
		PORT: "8080",
	}),
);

render((ctx) => program(ctx), { layers: fakeProcessEnv });
```

> Implementer note: the exact `Parameters<typeof api.render>[0]` type alias may need to be replaced with `RenderContext` if a direct import reads better — pick whichever produces the cleanest top-line at the program callsite. Both compile.

- [ ] **Step 2: Typecheck the file**

Run:
```bash
bun run --cwd examples check
```
Expected: PASS, including the `@ts-expect-error` on line ~46 (Bundle.entrypoint of `broken`) being satisfied.

- [ ] **Step 3: Run the file end-to-end**

Run:
```bash
bun run --cwd examples start-here.ts
```
(The script entry in `package.json` is added in Task 9 — for now invoke the file directly via bun.)

Expected output, in order:
1. A line like `=== act 1: bundle dep graph ===`
2. `composed 2 bundles: image-pulls, api`
3. The "removing image-pulls would fail" line
4. `=== act 2: env contract — manifest side ===`
5. YAML for the Deployment (single-doc; should include `env:` entries for `DATABASE_URL` and `PORT`)
6. `=== act 2: env contract — runtime side ===`
7. `port (literal) = 8080`
8. `db.url (redacted) = <redacted>` (the actual stringification of a Redacted value)

If `db.url` does not stringify with the `<redacted>` shape under Effect 4 beta, replace the log with `Redacted.value(env.db.url)` and add a comment that production code never unwraps; the example just needs to print *something* to prove the read happened.

- [ ] **Step 4: Commit**

```bash
git add examples/start-here.ts
git commit -m "feat(examples): start-here.ts — two-act flagship for skimmers"
```

---

## Phase 3 — Move and convert the existing demos

### Task 5: Move the eight numbered demos into `examples/recipes/` with renames

A pure file move + rename. No content changes. Keeps the renames as a distinct commit so the next task's `render()` conversion is a clean diff.

**Files:**
- Rename: `examples/01-branded-refs.ts` → `examples/recipes/branded-refs.ts`
- Rename: `examples/02-app-of-apps-deps.ts` → `examples/recipes/app-of-apps-deps.ts`
- Rename: `examples/03-images-config.ts` → `examples/recipes/images-config.ts`
- Rename: `examples/04-environment.ts` → `examples/recipes/env-runtime-decode.ts`
- Rename: `examples/05-env-bound.ts` → `examples/recipes/secret-backend-native.ts`
- Rename: `examples/06-external-secrets.ts` → `examples/recipes/secret-backend-external.ts`
- Rename: `examples/07-restart-on-rotation.ts` → `examples/recipes/restart-on-rotation.ts`
- Rename: `examples/08-bundle-deps.ts` → `examples/recipes/bundle-deps.ts`

- [ ] **Step 1: Move the files**

```bash
mkdir -p examples/recipes
git mv examples/01-branded-refs.ts          examples/recipes/branded-refs.ts
git mv examples/02-app-of-apps-deps.ts      examples/recipes/app-of-apps-deps.ts
git mv examples/03-images-config.ts         examples/recipes/images-config.ts
git mv examples/04-environment.ts           examples/recipes/env-runtime-decode.ts
git mv examples/05-env-bound.ts             examples/recipes/secret-backend-native.ts
git mv examples/06-external-secrets.ts      examples/recipes/secret-backend-external.ts
git mv examples/07-restart-on-rotation.ts   examples/recipes/restart-on-rotation.ts
git mv examples/08-bundle-deps.ts           examples/recipes/bundle-deps.ts
```

- [ ] **Step 2: Update tsconfig include glob**

Edit `examples/tsconfig.json`. Change:

```json
"include": ["./*.ts"]
```

to:

```json
"include": ["./*.ts", "./recipes/*.ts"]
```

- [ ] **Step 3: Verify the moved files still typecheck**

```bash
bun run --cwd examples check
```
Expected: PASS. No content changed yet, so behaviour is identical.

- [ ] **Step 4: Commit**

```bash
git add examples/recipes examples/tsconfig.json
git commit -m "refactor(examples): move numbered demos into recipes/ with problem-named filenames"
```

---

### Task 6: Convert all recipes to use `render()`

Each recipe today ends with the same Effect boilerplate:

```ts
NodeRuntime.runMain(program.pipe(Effect.scoped, Effect.provide(NodeServices.layer)));
```

Replace with a `render(...)` call. Where the program references `ctx`, lift it to a callback parameter. Where the program currently constructs `ctx` itself, drop the construction and use the one `render` passes in.

Apply the same conversion pattern to every recipe. The pattern is shown once below in full, then summarised per file.

**Files:**
- Modify: `examples/recipes/branded-refs.ts`
- Modify: `examples/recipes/app-of-apps-deps.ts`
- Modify: `examples/recipes/images-config.ts`
- Modify: `examples/recipes/env-runtime-decode.ts`
- Modify: `examples/recipes/secret-backend-native.ts`
- Modify: `examples/recipes/secret-backend-external.ts`
- Modify: `examples/recipes/restart-on-rotation.ts`
- Modify: `examples/recipes/bundle-deps.ts`

- [ ] **Step 1: Apply the pattern to `branded-refs.ts`**

Open `examples/recipes/branded-refs.ts`. Replace the top imports:

```ts
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { RenderContext, Yaml } from "@konfig.ts/core";
```

with:

```ts
import { render, Yaml } from "@konfig.ts/core";
```

The body uses `const ctx = RenderContext.make("prod");` inside a generator. Change the program from:

```ts
const program = Effect.gen(function* () {
	const ctx = RenderContext.make("prod");
	const secret = yield* dbCreds.render(ctx);
	const [deployment, service] = yield* api.render(ctx);
	for (const r of [secret, deployment, service]) {
		yield* Effect.log(`${Yaml.serialize({ value: r })}---`);
	}
});

NodeRuntime.runMain(program.pipe(Effect.scoped, Effect.provide(NodeServices.layer)));
```

to:

```ts
render((ctx) =>
	Effect.gen(function* () {
		const secret = yield* dbCreds.render(ctx);
		const [deployment, service] = yield* api.render(ctx);
		for (const r of [secret, deployment, service]) {
			yield* Effect.log(`${Yaml.serialize({ value: r })}---`);
		}
	}),
);
```

The `RenderContext` import is dropped because `render` constructs the context and passes it as the callback argument.

- [ ] **Step 2: Apply the same pattern to the remaining seven files**

For each of the seven remaining recipes:

| File | Notes specific to this file |
|---|---|
| `app-of-apps-deps.ts` | Uses `Effect.runPromise(report)` rather than `NodeRuntime.runMain`. Replace the `Effect.runPromise(report)` call with `render((_ctx) => report)` — pass `_ctx` since `report` doesn't reference it. Drop the `NodeRuntime`/`NodeServices` imports if present. |
| `images-config.ts` | Uses `Effect.runPromise(program)` and doesn't construct a `RenderContext` at all. Replace with `render((_ctx) => program)`. The unused `_ctx` is fine. |
| `env-runtime-decode.ts` | The biggest file. Has both manifest rendering AND a `ConfigProvider.layer(...)` for the runtime side. Lift the existing `const ctx = RenderContext.make("prod")` out and pass it via the `render` callback. Pass `{ layers: fakeEnv }` (renaming the local from `fakeEnv` to something descriptive if needed) as the second argument to `render`. |
| `secret-backend-native.ts` | Has `const ctx = RenderContext.make("prod")` inside the program — drop it and use the callback's `ctx`. |
| `secret-backend-external.ts` | Same pattern as `secret-backend-native.ts`. |
| `restart-on-rotation.ts` | Has `.pipe(Effect.provide(sessionKeyK8s.layer!))` before the runMain. Move that `Effect.provide` *inside* the program callback so the final `render(...)` call stays uncluttered: `render((ctx) => program(ctx).pipe(Effect.provide(sessionKeyK8s.layer!)))`. |
| `bundle-deps.ts` | Identical to the original; just convert the runner. |

After each file, run `bun run --cwd examples check` to catch a regression early.

- [ ] **Step 3: Final typecheck of all recipes**

```bash
bun run --cwd examples check
```
Expected: PASS.

- [ ] **Step 4: Smoke-run every recipe**

```bash
for f in examples/recipes/*.ts; do
  echo "=== $f ==="
  bun run "$f" 2>&1 | head -3 || echo "FAILED: $f"
done
```
Expected: each recipe prints at least one line of meaningful output (a log line, YAML, or `=== ... ===` banner). No uncaught exceptions, no `module not found`. `app-of-apps-deps.ts` and `bundle-deps.ts` will additionally log a "0 apps" or "2 bundles" summary line.

- [ ] **Step 5: Commit**

```bash
git add examples/recipes/
git commit -m "refactor(examples): convert recipes to render() — single-line runner, no NodeRuntime boilerplate"
```

---

### Task 7: Add `recipes/helm-digest-verify.ts`

The README leads with "Helm with digest verification" but no example demonstrates it. Add a focused recipe.

The recipe declares a `Helm.release` with a known digest, renders it, and shows that flipping the digest causes a `HelmDigestMismatch` error. Verifying the *negative* case is what makes the recipe land — the reader sees the protection mechanism kick in.

**Files:**
- Create: `examples/recipes/helm-digest-verify.ts`

- [ ] **Step 1: Inspect `Helm.release` to confirm the API**

```bash
rg "export const release|export function release|HelmDigestMismatch" packages/core/src/Helm.ts | head -20
```

Open `packages/core/src/Helm.ts` and read the first ~50 lines, plus the export of `release`. Confirm the option name (`digest`), the type (likely `sha256:<hex>`), and how errors are surfaced (`HelmDigestMismatch` is already exported from `RenderError.ts`).

- [ ] **Step 2: Write the recipe**

Create `examples/recipes/helm-digest-verify.ts` with:

```ts
// Helm releases are pinned by digest. Every render verifies the
// cached .tgz against the digest; a mismatch fails the render with
// HelmDigestMismatch — no silent drift from upstream chart edits.
//
// This recipe pulls a tiny public chart, prints the rendered manifest
// stream, then re-runs the render with a deliberately-wrong digest
// and prints the typed error.

import { HelmDigestMismatch, Helm, render } from "@konfig.ts/core";
import { Effect, Exit } from "effect";

// REPLACE the digest below with the real sha256 of the chart's .tgz
// before committing. Until then this example will fail on the first
// render with a HelmDigestMismatch — which is itself a useful demo,
// but document it.
const GOOD_DIGEST = "sha256:0000000000000000000000000000000000000000000000000000000000000000";
const BAD_DIGEST  = "sha256:1111111111111111111111111111111111111111111111111111111111111111";

const releaseAt = (digest: string) =>
	Helm.release({
		releaseName: "demo",
		namespace: "default",
		repo: "https://charts.bitnami.com/bitnami",
		chart: "redis",
		version: "20.0.0",
		digest,
		values: {},
	});

render((ctx) =>
	Effect.gen(function* () {
		yield* Effect.log("=== render with the correct digest ===");
		const docs = yield* releaseAt(GOOD_DIGEST).render(ctx);
		yield* Effect.log(`rendered ${docs.length} documents`);

		yield* Effect.log("=== render with a wrong digest ===");
		const exit = yield* releaseAt(BAD_DIGEST).render(ctx).pipe(Effect.exit);
		Exit.match(exit, {
			onFailure: (cause) => {
				const err = cause.toString();
				const isMismatch = err.includes("HelmDigestMismatch");
				return Effect.log(
					isMismatch
						? "✓ HelmDigestMismatch — the byte-flip was caught."
						: `(unexpected failure: ${err})`,
				);
			},
			onSuccess: () => Effect.log("(unexpected success — the wrong digest should have failed)"),
		});
		void HelmDigestMismatch; // suppress unused-import lint if Exit.match path doesn't reference it
	})
);
```

> Implementer note on `GOOD_DIGEST`: at implementation time, either (a) compute the real digest by running `helm pull bitnami/redis --version 20.0.0` and `sha256sum` of the resulting `.tgz`, or (b) replace the chart with one that's already in a fixture under `packages/core/test-types/` or similar with a known digest. The recipe is more valuable when the happy path also works. If neither is convenient, document the placeholder behaviour in a banner comment at the top of the file.

- [ ] **Step 3: Typecheck**

```bash
bun run --cwd examples check
```
Expected: PASS.

- [ ] **Step 4: Run the recipe (best-effort)**

```bash
bun run examples/recipes/helm-digest-verify.ts
```
Expected: prints both banners. The first render may fail until the implementer sets a real `GOOD_DIGEST`; the *second* render must print `✓ HelmDigestMismatch` to count as a successful demo regardless.

- [ ] **Step 5: Commit**

```bash
git add examples/recipes/helm-digest-verify.ts
git commit -m "feat(examples): helm-digest-verify recipe — show digest enforcement on the wrong byte"
```

---

### Task 8: Write `recipes/README.md`

A short index, grouped by problem.

**Files:**
- Create: `examples/recipes/README.md`

- [ ] **Step 1: Write the file**

Create `examples/recipes/README.md` with:

```markdown
# Recipes

Focused per-feature snippets. Start with [`../start-here.ts`](../start-here.ts)
for the 90-second tour; come here when you need the answer to one
specific question.

## Composition
- [`bundle-deps.ts`](./bundle-deps.ts) — compose Bundles, catch missing providers at compile time
- [`app-of-apps-deps.ts`](./app-of-apps-deps.ts) — same idea on the ArgoCD side

## Env contracts
- [`env-runtime-decode.ts`](./env-runtime-decode.ts) — read a Secret atom at process startup
- [`secret-backend-native.ts`](./secret-backend-native.ts) — emit a plain Kubernetes Secret
- [`secret-backend-external.ts`](./secret-backend-external.ts) — emit an ExternalSecret CR
- [`restart-on-rotation.ts`](./restart-on-rotation.ts) — pod restart pinned to Secret values

## Charts
- [`helm-digest-verify.ts`](./helm-digest-verify.ts) — `Helm.release` rejects a chart whose cached `.tgz` doesn't match the pinned digest

## Types
- [`branded-refs.ts`](./branded-refs.ts) — `SecretRef<N, K>` rejects wrong names and wrong keys
- [`images-config.ts`](./images-config.ts) — typed `images.json` loader with per-env lookup
```

- [ ] **Step 2: Commit**

```bash
git add examples/recipes/README.md
git commit -m "docs(examples): recipes index"
```

---

## Phase 4 — Wire it up

### Task 9: Update `examples/package.json` scripts

The flagship gets a top-level script. Each recipe gets a namespaced script. Drop the obsolete numbered scripts (`01`–`07`).

**Files:**
- Modify: `examples/package.json`

- [ ] **Step 1: Replace the scripts block**

Open `examples/package.json`. Replace the entire `"scripts"` block with:

```json
"scripts": {
    "start-here": "bun run start-here.ts",
    "recipes:branded-refs": "bun run recipes/branded-refs.ts",
    "recipes:app-of-apps-deps": "bun run recipes/app-of-apps-deps.ts",
    "recipes:images-config": "bun run recipes/images-config.ts",
    "recipes:env-runtime-decode": "bun run recipes/env-runtime-decode.ts",
    "recipes:secret-backend-native": "bun run recipes/secret-backend-native.ts",
    "recipes:secret-backend-external": "bun run recipes/secret-backend-external.ts",
    "recipes:restart-on-rotation": "bun run recipes/restart-on-rotation.ts",
    "recipes:bundle-deps": "bun run recipes/bundle-deps.ts",
    "recipes:helm-digest-verify": "bun run recipes/helm-digest-verify.ts",
    "check": "tsc -p tsconfig.json --noEmit"
}
```

- [ ] **Step 2: Verify the flagship script runs**

```bash
bun run --cwd examples start-here
```
Expected: same output as Task 4, Step 3.

- [ ] **Step 3: Verify one recipe script runs**

```bash
bun run --cwd examples recipes:bundle-deps
```
Expected: a "composed 2 bundles" line plus the bundle listing.

- [ ] **Step 4: Commit**

```bash
git add examples/package.json
git commit -m "chore(examples): promote start-here script, namespace recipes"
```

---

### Task 10: Audit and migrate `examples/full-stack/` boilerplate to `render()`

The full-stack example is unchanged in shape but should not ship the old boilerplate now that `render()` exists.

**Files:**
- Variable; depends on what the audit finds.

- [ ] **Step 1: Find every place `full-stack` calls `NodeRuntime.runMain` or constructs a `RenderContext` directly**

```bash
rg "NodeRuntime\.runMain|NodeServices\.layer|RenderContext\.make" examples/full-stack/
```

- [ ] **Step 2: For each hit, apply the same conversion pattern as Task 6**

If the hit is in an env-entry file (`infra/envs/prod.ts`, `staging.ts`, `broken.ts`) that *defines* the AppOfApps and gets run by the CLI, **leave it alone** — the CLI is the entrypoint there, not `runMain`. The `broken.ts` file explicitly demonstrates a type error; it should still fail to typecheck after the change, with the same `@ts-expect-error` line and the same surrounding code.

If the hit is in an ad-hoc runner script (likely `apps/api/src/main.ts` or similar), convert it to `render(...)` if and only if it's actually rendering manifests. App entry points that just start an HTTP server should not be touched.

- [ ] **Step 3: Re-typecheck and re-run**

```bash
bun run --cwd examples/full-stack check
```
Expected: PASS, with the same `@ts-expect-error` in `infra/envs/broken.ts` still satisfied.

- [ ] **Step 4: Commit (only if anything changed)**

```bash
git add examples/full-stack
git commit -m "chore(full-stack): migrate runner boilerplate to render() where applicable"
```

If the audit found nothing to convert, skip the commit. Note in the plan-execution log that the full-stack tree was already clean of the boilerplate.

---

### Task 11: Update repo-root README, `docs/public-api.md`, `CHANGELOG.md`

Final pass: make sure the docs reflect the new entry point.

**Files:**
- Modify: `README.md` (repo root)
- Modify: `docs/public-api.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Update repo-root README — Quickstart section**

Open the repo root `README.md`. Find the existing Quickstart block (around line 121–134 in the current file) and replace the paragraph that points at `examples/full-stack` with:

```markdown
Start with [`examples/start-here.ts`](./examples/start-here.ts) for the
90-second tour. See [`examples/recipes/`](./examples/recipes/) for
focused per-feature snippets. See
[`examples/full-stack`](./examples/full-stack) for a complete monorepo
with env contracts, SOPS, Helm, and ArgoCD wiring — plus the
worked-failure files under
[`examples/full-stack/infra/envs/`](./examples/full-stack/infra/envs)
that demonstrate every `@ts-expect-error` the type system catches.
```

- [ ] **Step 2: Update README's "60-second tour" snippets if they show `NodeRuntime.runMain`**

Skim the three code blocks in the "60-second tour" section. If any one of them shows a `NodeRuntime.runMain(...)` line, replace it with `render(...)`. If none do (they're meant to illustrate concepts, not be runnable), leave them alone.

- [ ] **Step 3: Add `render` and `renderManifest` entries to `docs/public-api.md`**

Open `docs/public-api.md` and add a `render` / `renderManifest` section under the `@konfig.ts/core` package. The body for each:

```markdown
### `render(program, options?)`

Top-level entrypoint for konfig render programs.

- `program: (ctx: RenderContext) => Effect.Effect<void, E, NodeServices | R>` — your render logic, receives a freshly-made `RenderContext`.
- `options.env?: string` — overrides the context env (default `"prod"`).
- `options.layers?: Layer.Layer<R, never, never>` — extra layers merged with `NodeServices.layer` (e.g. a `ConfigProvider` for the runtime side of an env contract).

Wraps the program in `Effect.scoped`, provides the merged layer, and hands off to `NodeRuntime.runMain`.

### `renderManifest({ manifest, ctx })`

Lift a single `Manifest<A>` to an Effect that produces `A`. Used by the CLI's render pipeline. Most user code calls `render(...)` (above) instead.
```

If the file uses a table-of-contents pattern, add entries there too.

- [ ] **Step 4: Add CHANGELOG entries**

Open `CHANGELOG.md`. Under the next unreleased section (creating one if needed), add:

```markdown
### Added
- `@konfig.ts/core`: top-level `render(program, options?)` entrypoint that collapses the per-file `NodeRuntime.runMain(...).pipe(Effect.scoped, Effect.provide(NodeServices.layer))` boilerplate. `options.env` defaults to `"prod"`; `options.layers` accepts an extra layer merged with `NodeServices.layer`.
- `examples/start-here.ts`: 90-second flagship for new readers — Bundle dep-graph + env-contract in two acts.
- `examples/recipes/`: home for the previously-numbered demos, plus a new `helm-digest-verify.ts` that exercises `Helm.release({ digest })`.

### Changed
- **Breaking** (`@konfig.ts/core`): the existing `render({ manifest, ctx })` helper renamed to `renderManifest({ manifest, ctx })` to free the `render` slot for the new entrypoint. The shape is unchanged.
- `@konfig.ts/core`: `@effect/platform-node` promoted from `devDependency` to `peerDependency`.
- `examples/`: the eight numbered demos (`01-branded-refs.ts` ... `08-bundle-deps.ts`) moved into `examples/recipes/` with problem-named filenames.
```

- [ ] **Step 5: Typecheck the repo end-to-end and run the top-level test script**

```bash
bun run check
bun run test
```
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add README.md docs/public-api.md CHANGELOG.md
git commit -m "docs: surface render() entrypoint and recipes layout in README + public-api + CHANGELOG"
```

---

## Self-Review

**Spec coverage** (each spec section vs. plan task that implements it):

- Tree layout → Tasks 4, 5, 7, 8
- Flagship file structure → Task 4
- New `render` API surface → Tasks 2, 3
- Existing `render` rename → Task 1
- Recipes README index → Task 8
- `package.json` and `tsconfig.json` updates → Tasks 5, 9
- Repo-root README updates → Task 11
- `docs/public-api.md` entry → Task 11
- `CHANGELOG.md` entry → Task 11
- Full-stack audit → Task 10
- New `helm-digest-verify.ts` recipe → Task 7

No spec section is missing from the plan.

**Type consistency:**
- `render` signature is consistent between Task 3 (impl) and Task 4 (flagship use).
- `renderManifest` shape (`{ manifest, ctx }`) matches between Task 1's rename and any future callers.
- `RenderOptions<RIn>` is the type name used in both the impl (Task 3) and the index export (Task 3, Step 5).

**Placeholder scan:**
- Task 7 (Helm digest) contains a placeholder digest `sha256:0000...` and an explicit implementer note about how to obtain a real one. This is intentional — the recipe demonstrates the failure mode regardless, and the spec explicitly does not block on chart provisioning. Documented inline.
- Task 4 has an implementer note about the `Parameters<typeof api.render>[0]` type alias; this is a stylistic call-out, not a missing detail.
- No other "TBD" / "implement later" / "similar to Task N" entries.

**Independent testability:**
- Tasks 1–3 (core changes) can be merged and shipped independently — they don't break any consumer, they only rename one existing export and add a new one.
- Tasks 4–11 depend on Tasks 1–3 (specifically the new `render` export) but not on each other in tight ways — Tasks 5, 6, 7, 8 are largely parallel-safe within the recipes/ directory.
- Each task ends with a verification step and a commit.
