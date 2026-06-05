// Compile-time assertions for port-name branding. `defineContainer`
// captures the literal port-name union as a phantom on `ContainerSpec`,
// and `Service.fromContainer` propagates it to the typed `ServicePortSpec`.
// A mistyped probe port or `targetPort` fails at compile time.

import type { ContainerSpec, NamesOf } from "@konfig.ts/k8s";
import { defineContainer, Port, Service } from "@konfig.ts/k8s";

type Expect<T extends true> = T;
type Equal<X, Y> =
	(<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;

// 1 · `NamesOf` extracts the union of literal port names.
type PortsTuple = readonly [
	ReturnType<typeof Port.make<"http">>,
	ReturnType<typeof Port.make<"metrics">>,
];
type _Names = Expect<Equal<NamesOf<PortsTuple>, "http" | "metrics">>;

// 2 · `defineContainer` returns `ContainerSpec<"http" | "metrics">`.
const api = defineContainer({
	name: "api",
	image: "x",
	ports: [
		Port.make({ name: "http", containerPort: 8080 }),
		Port.make({ name: "metrics", containerPort: 9090 }),
	],
});
type _ApiSpec = Expect<Equal<typeof api, ContainerSpec<"http" | "metrics", never>>>;

// 3 · Probe port — declared name OK.
const okProbe = defineContainer({
	name: "api",
	image: "x",
	ports: [Port.make({ name: "http", containerPort: 8080 })],
	readinessProbe: { httpGet: { path: "/h", port: Port.ref("http") } },
});
void okProbe;

// 4 · Probe port — undeclared name fails.
const badProbe = defineContainer({
	name: "api",
	image: "x",
	ports: [Port.make({ name: "http", containerPort: 8080 })],
	readinessProbe: {
		// @ts-expect-error - "grpc" is not in declared port names ("http").
		httpGet: { path: "/h", port: Port.ref("grpc") },
	},
});
void badProbe;

// 5 · Probe — bare number always accepted.
const numericProbe = defineContainer({
	name: "api",
	image: "x",
	ports: [Port.make({ name: "http", containerPort: 8080 })],
	readinessProbe: { httpGet: { path: "/h", port: 8080 } },
});
void numericProbe;

// 6 · `Service.fromContainer` — targetPort with a declared name OK.
const _okSvc = Service.fromContainer({
	name: "api",
	namespace: "default",
	selector: { app: "api" },
	forContainer: api,
	ports: [{ port: 80, targetPort: Port.ref("http") }],
});

// 7 · `Service.fromContainer` — targetPort with an undeclared name fails.
const _badSvc = Service.fromContainer({
	name: "api",
	namespace: "default",
	selector: { app: "api" },
	forContainer: api,
	ports: [
		// @ts-expect-error - "admin" is not in api's declared port names ("http" | "metrics").
		{ port: 80, targetPort: Port.ref("admin") },
	],
});

void _okSvc;
void _badSvc;

export type _Tests = readonly [_Names, _ApiSpec];
