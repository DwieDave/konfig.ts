// Kinds whose presence/absence is tracked in the type system.
// Other resources (Deployment, Service, Ingress, …) are not tracked: a typo
// there is caught by structural typing or by the cluster at apply time.
//
// M9 dropped the `Deps` / `Empty` / `Subtract` / `Combine` / `Single` record
// algebra — dep tracking now lives in Effect's R via yieldable `Dep.*`
// Keys (see `./deps.ts`). `Kind` is the only enum that survived because
// the renderer (`yaml/sort`) still uses it to pick the right output
// path for each rendered resource.

export type Kind = "Secret" | "ConfigMap" | "Namespace" | "ServiceAccount" | "Application";

export const KINDS: readonly Kind[] = [
	"Secret",
	"ConfigMap",
	"Namespace",
	"ServiceAccount",
	"Application",
];
