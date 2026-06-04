/**
 * Worked example of the `LiteralName<T>` brand catching a `string`
 * widening at the call site of a module factory.
 *
 * If `Application.define`'s `name` parameter widens to `string`, the
 * dep-graph slot `Dep.Provide<"App", string>` collapses every
 * Application into the same key — and so a missing dep silently
 * resolves to a different app's provider. `LiteralName<Name>` rewrites
 * to a structured `_konfig_error` type when `Name` is the bare
 * `string`, so the call site fails to compile.
 *
 * Not registered in konfig.json — pure typing regression.
 */
import { Application } from "@konfig.ts/argocd";
import { Effect } from "effect";
import { cluster } from "../cluster";

// Source helper.
const src = (name: string) => ({
  repoURL: cluster.repositoryUrl,
  targetRevision: "main",
  path: `./infra/k8s/manifests/widened/${name}`,
});

// Baseline: name is a string literal "api" — no error.
const _ok = Application.define({
  name: "api",
  namespace: "app",
  source: src("api"),
  build: () => [],
});
void _ok;

// (1) `name` flows in from a string variable; `Name` widens to
//     `string` and `LiteralName<string>` resolves to the branded
//     error type, so the call below fails to typecheck.
const dynamicName: string = process.env.MY_APP_NAME ?? "api";
const _widened = Application.define({
  // @ts-expect-error Application name must be a string literal — wrapper widened `Name` to `string`.
  name: dynamicName,
  namespace: "app",
  source: src("api"),
  build: () => [],
});
void _widened;

// (2) Same gotcha at the namespace slot.
const dynamicNs: string = process.env.MY_NS ?? "app";
const _widenedNs = Application.define({
  name: "api",
  // @ts-expect-error Application namespace must be a string literal.
  namespace: dynamicNs,
  source: src("api"),
  build: () => [],
});
void _widenedNs;

// (3) `Module.fixedNs` / `Module.dynamicNs` are the recommended
//     factory shapes — they re-apply `LiteralName` at every layer so
//     a misuse from inside a module wrapper also fails here.
void Effect.succeed;
