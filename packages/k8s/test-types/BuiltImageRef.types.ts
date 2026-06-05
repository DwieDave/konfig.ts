// Compile-time assertions for BuiltImageRef<App> + Dep.Image dep-graph
// integration. A container module yielding Dep.Image("api") must be
// matched by a build module providing it, or the residual fires at
// AppOfApps.entrypoint.

import type { BuiltImageRef, BuiltImageRefApp, Dep } from "@konfig.ts/core";
import { Dep as DepNS } from "@konfig.ts/core";
import { defineContainer, Port } from "@konfig.ts/k8s";
import { Effect } from "effect";

type Expect<T extends true> = T;
type Equal<X, Y> =
	(<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;

// 1 · BuiltImageRef.of brands the app literal.
const apiImage = DepNS.BuiltImageRef.of({
	app: "api",
	registry: "ghcr.io/example",
	tag: "1.0.0",
});
type _ApiApp = Expect<Equal<BuiltImageRefApp<typeof apiImage>, "api">>;

// 2 · DepNS.provideImage returns a Layer providing Dep.Provide<"Image", App>.
const apiLayer = DepNS.provideImage({ app: "api", registry: "ghcr.io/x", tag: "1" });
type _ApiLayerOut = Expect<
	Equal<typeof apiLayer extends import("effect").Layer.Layer<infer O, any, any> ? O : never, Dep.Provide<"Image", "api">>
>;

// 3 · Container.image accepts both raw strings and branded refs.
const _branded = defineContainer({
	name: "api",
	image: apiImage,
	ports: [Port.make({ name: "http", containerPort: 8080 })],
});

const _raw = defineContainer({
	name: "postgres",
	image: "docker.io/bitnami/postgresql:16.0.0",
	ports: [Port.make({ name: "tcp", containerPort: 5432 })],
});

// 4 · Cross-app brand mismatch — assigning an "api" ref where the
//     surrounding context expects "worker".
declare const expectedWorker: BuiltImageRef<"worker">;
// @ts-expect-error - BuiltImageRef<"api"> not assignable to BuiltImageRef<"worker">.
const _wrong: typeof expectedWorker = apiImage;

// 5 · Consumer yields Dep.Image(app); the resulting Effect carries
//     Need<"Image", App> in its R channel until a provider is applied.
const programNeedsApi = Effect.gen(function* () {
	const ref = yield* DepNS.Image("api");
	return String(ref);
});
type _ProgramR =
	typeof programNeedsApi extends Effect.Effect<infer _A, infer _E, infer R> ? R : never;
type _R = Expect<Equal<_ProgramR, Dep.Need<"Image", "api">>>;

// 6 · After Effect.provide, the Need is discharged.
const programWithApi = programNeedsApi.pipe(Effect.provide(apiLayer));
type _ResidualR =
	typeof programWithApi extends Effect.Effect<infer _A, infer _E, infer R> ? R : never;
type _Discharged = Expect<Equal<_ResidualR, never>>;

void _branded;
void _raw;
void _wrong;

export type _Tests = readonly [_ApiApp, _ApiLayerOut, _R, _Discharged];
