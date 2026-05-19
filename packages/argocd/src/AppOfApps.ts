
import type { Manifest as CoreManifest } from "@konfig.ts/core";
import type { Effect } from "effect";
import type { Application } from "./Application";

export interface AppOfAppsTarget {
	readonly repoURL: string;
	readonly branch: string;
	readonly rootPath: string;
	readonly controllerNamespace?: string;
}

export interface AppOfAppsDefaults {
	readonly destination?: {
		readonly server?: string;
		readonly namespace?: string;
	};
	readonly syncPolicy?: import("./Application").SyncPolicy;
}

export interface AppOfAppsResult {
	readonly name: string;
	readonly target: AppOfAppsTarget;
	readonly defaults: AppOfAppsDefaults;
	readonly apps: ReadonlyArray<Application>;
}

export interface AppOfAppsMakeOptions {
	readonly name?: string;
	readonly target: AppOfAppsTarget;
	readonly defaults: AppOfAppsDefaults;
	readonly apps: ReadonlyArray<Application>;
}

export const make = (opts: AppOfAppsMakeOptions): AppOfAppsResult => ({
	name: opts.name ?? "apps",
	target: opts.target,
	defaults: opts.defaults,
	apps: opts.apps,
});

export const entrypoint = <A, E, R extends CoreManifest.RenderServices = never>(
	program: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> => program;
