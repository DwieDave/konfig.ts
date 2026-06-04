/**
 * Worked example of the dep-graph catching two Applications that share
 * a name.
 *
 * `Application.define({ name: "api", ... })` produces
 * `Dep.Provide<"App", "api">` and `Dep.Provide<"Application", "api">`.
 * Merging two such layers via `Layer.mergeAll` (or `provideMerge`) is
 * fine — Effect's Layer system accepts redundant providers. But the
 * second definition's `Out` channel re-occupies the same slot, so the
 * dep-graph sees a SINGLE provider for "api" with the second Effect
 * winning. konfig flags this at `AppOfApps.entrypoint` by requiring
 * the `In` channel to be `never` AND each ApplicationHandle to be a
 * distinct service tag.
 *
 * Not registered in konfig.json — pure typing regression.
 */
import { AppOfApps, Application } from "@konfig.ts/argocd";
import { Effect, Layer } from "effect";
import { cluster } from "../cluster";

const src = (name: string) => ({
  repoURL: cluster.repositoryUrl,
  targetRevision: "main",
  path: `./infra/k8s/manifests/collision/${name}`,
});

const apiV1 = Application.define({
  name: "api",
  namespace: "app",
  source: src("api"),
  build: () => [],
});

const apiV2 = Application.define({
  name: "api",
  namespace: "app",
  source: src("api"),
  build: () => [],
});

// Composing two same-named handles into one program is structurally
// allowed by Layer.mergeAll (the second silently shadows the first
// from a Layer perspective). The pattern below is what the example
// gallery flags as a "name collision" smell — wrap one of them with a
// distinct `name` literal at the call site.
const program = Effect.gen(function* () {
  const a = yield* apiV1;
  const b = yield* apiV2;
  return AppOfApps.make({
    target: { repoURL: cluster.repositoryUrl, branch: "main", rootPath: "./out" },
    defaults: {},
    apps: [a, b],
  });
}).pipe(Effect.provide(Layer.mergeAll(apiV1.layer, apiV2.layer)));

// At runtime the second `apiV2` will silently win the layer; konfig
// can't catch this purely from a TS-type union of two `App<"api">`
// tags. A 1.0-grade fix is on the M4 roadmap (a per-bundle
// duplicate-app-name lint that walks the resolved AppOfApps shape).
export default AppOfApps.entrypoint(program);
