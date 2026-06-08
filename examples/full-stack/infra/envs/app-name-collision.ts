/**
 * Worked example of the dep-graph NOT catching two Applications that
 * share a name.
 *
 * `Application.define({ name: "api", ... })` produces
 * `Dep.Provide<"App", "api">` and `Dep.Provide<"Application", "api">`.
 * Folding two such layers via `Compose.composeLayers` (what
 * `AppOfApps.fromModules` does internally) is structurally allowed —
 * Effect's Layer system accepts redundant providers, and the second
 * definition's `Out` channel re-occupies the same slot, so the
 * dep-graph sees a SINGLE provider for "api" with the second Effect
 * silently winning.
 *
 * konfig can't catch this purely from a TS-type union of two
 * `App<"api">` tags. A 1.0-grade fix is on the M4 roadmap (a
 * per-bundle duplicate-app-name lint that walks the resolved
 * AppOfApps shape).
 *
 * Not registered in konfig.json — pure typing regression.
 */
import { AppOfApps, Application } from "@konfig.ts/argocd";
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

// Both handles claim `App<"api">`; `fromModules` happily folds them
// and the second silently shadows the first. The example gallery
// flags this as a "name collision" smell — wrap one of them with a
// distinct `name` literal at the call site.
export default AppOfApps.entrypoint(
  AppOfApps.fromModules({
    target: { repoURL: cluster.repositoryUrl, branch: "main", rootPath: "./out" },
    defaults: {},
    modules: [apiV1, apiV2] as const,
  }),
);
