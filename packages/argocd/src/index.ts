// @konfig.ts/argocd — Application + AppOfApps with type-level dep verification.

export type { ArgoSource, BuildMetadata, SyncPolicy } from "./Application";
export * as Application from "./Application";
export type { AppOfAppsDefaults, AppOfAppsResult, AppOfAppsTarget } from "./AppOfApps";
export * as AppOfApps from "./AppOfApps";
export {
	applicationCRFilename,
	buildCR,
	emitApplicationCR,
	serializeApplicationCR,
} from "./emit";
export type { HookPhase } from "./sync";
export { Hook, SyncOptions, SyncWave } from "./sync";
