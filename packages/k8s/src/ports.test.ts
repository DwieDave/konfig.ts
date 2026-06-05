import { render, RenderContext } from "@konfig.ts/core";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { Container } from "./container";
import { Service } from "./network";
import { Port } from "./ports";

const ctx = RenderContext.make("test");
const _run = <A>(eff: Effect.Effect<A, unknown>): Promise<A> =>
	Effect.runPromise(eff as Effect.Effect<A, never, never>);

describe("Port.make / Port.ref", () => {
	it("Port.make carries the literal name as both runtime value and type", () => {
		const p = Port.make({ name: "http", containerPort: 8080 });
		expect(p.containerPort).toBe(8080);
		expect(p.name).toBe("http");
	});

	it("Port.ref is the bare string at runtime", () => {
		expect(Port.ref("http")).toBe("http");
	});

	it("Port.make preserves protocol and host fields", () => {
		const p = Port.make({ name: "metrics", containerPort: 9090, protocol: "TCP", hostPort: 9090 });
		expect(p.protocol).toBe("TCP");
		expect(p.hostPort).toBe(9090);
	});
});

describe("Container", () => {
	it("returns a ContainerSpec whose ports are the input array", () => {
		const c = Container.define({
			name: "api",
			image: "ghcr.io/example/api:1.0.0",
			ports: [Port.make({ name: "http", containerPort: 8080 })],
			readinessProbe: {
				httpGet: { path: "/healthz", port: Port.ref("http") },
				periodSeconds: 5,
			},
		});
		expect(c.name).toBe("api");
		expect(c.ports).toHaveLength(1);
		expect(c.ports[0]?.name).toBe("http");
		expect(c.readinessProbe?.httpGet?.port).toBe("http");
		expect(c.readinessProbe?.periodSeconds).toBe(5);
	});

	it("numeric probe port is accepted", () => {
		const c = Container.define({
			name: "api",
			image: "x",
			ports: [Port.make({ name: "http", containerPort: 8080 })],
			readinessProbe: { httpGet: { path: "/", port: 8080 } },
		});
		expect(c.readinessProbe?.httpGet?.port).toBe(8080);
	});
});

describe("Service.fromContainer", () => {
	const api = Container.define({
		name: "api",
		image: "x",
		ports: [
			Port.make({ name: "http", containerPort: 8080 }),
			Port.make({ name: "metrics", containerPort: 9090 }),
		],
	});

	it("emits a K8s Service from a typed container + port spec", async () => {
		const svc = Service.fromContainer({
			name: "api",
			namespace: "default",
			selector: { app: "api" },
			forContainer: api,
			ports: [
				{ port: 80, targetPort: Port.ref("http") },
				{ port: 9090, targetPort: Port.ref("metrics") },
			],
		});
		const out = await _run(render({ manifest: svc, ctx }));
		expect(out.kind).toBe("Service");
		expect(out.spec?.selector).toEqual({ app: "api" });
		expect(out.spec?.ports?.[0]).toEqual({ port: 80, targetPort: "http" });
		expect(out.spec?.ports?.[1]).toEqual({ port: 9090, targetPort: "metrics" });
	});

	it("numeric targetPort still works", () => {
		const svc = Service.fromContainer({
			name: "api",
			namespace: "default",
			selector: { app: "api" },
			forContainer: api,
			ports: [{ port: 80, targetPort: 8080 }],
		});
		expect(svc).toBeDefined();
	});
});
