import { Application } from "@konfig.ts/argocd";
import {
	bundledDeployment,
	bundledNetworkPolicy,
	defineContainer,
	definedService,
	port,
	portRef,
} from "@konfig.ts/k8s";
import { Effect } from "effect";
import { apiPods, redisCachePods, workerPods } from "../podSets";

export interface RedisCacheOptions {
	readonly source: Application.ArgoSource;
}

/**
 * Redis cache sidecar — demonstrates round-1 prototypes 1 and 2
 * end-to-end without going through `Workload.web`.
 *
 *   - `defineContainer({ ports: [port({ name: "redis", ... })] })`
 *     captures the literal port-name union ("redis") and constrains
 *     the readiness probe's `tcpSocket.port` to it.
 *
 *   - `bundledDeployment({ podSet: redisCachePods, ... })` derives
 *     `spec.selector.matchLabels` AND `template.metadata.labels` from
 *     the same `SelectorBundle` — drift between the two (a classic
 *     "Service has no endpoints" footgun) is structurally impossible.
 *
 *   - `definedService({ forContainer: redisContainer, ... })` ties
 *     `targetPort` to the container's port-name union via NoInfer —
 *     `targetPort: portRef("rdis")` is a compile-time error, not a
 *     "unable to find named port" pod-startup failure.
 *
 *   - `bundledNetworkPolicy({ podSet, ingress: [{ from: [{ podSet }] }] })`
 *     restricts ingress to the api and worker pod sets (imported as
 *     SelectorBundles from `infra/podSets.ts`). The same label record
 *     drives Workload.web's internal selectors AND this netpol's
 *     `spec.ingress[].from[].podSelector` — single source of truth.
 *
 * The redis image stays as a raw string (the BuiltImageRef escape
 * hatch for vendor images) — there's no in-tree build for upstream
 * containers, so no `Dep.Image` is required.
 */
export const defineRedisCache = (opts: RedisCacheOptions) =>
	Application.define({
		name: "redis-cache",
		namespace: "app",
		source: opts.source,
		build: Effect.gen(function* () {
			const redisContainer = defineContainer({
				name: "redis",
				image: "docker.io/library/redis:7-alpine",
				ports: [port({ name: "redis", containerPort: 6379 })],
				readinessProbe: {
					tcpSocket: { port: portRef("redis") },
					periodSeconds: 5,
				},
			});

			const deployment = bundledDeployment({
				name: "redis-cache",
				namespace: "app",
				podSet: redisCachePods,
				replicas: 1,
				template: { spec: { containers: [redisContainer] } },
			});

			const service = definedService({
				name: "redis-cache",
				namespace: "app",
				selector: redisCachePods.labels,
				forContainer: redisContainer,
				ports: [{ port: 6379, targetPort: portRef("redis") }],
			});

			const netpol = bundledNetworkPolicy({
				name: "redis-cache-ingress",
				namespace: "app",
				podSet: redisCachePods,
				policyTypes: ["Ingress"],
				ingress: [
					{
						from: [{ podSet: apiPods }, { podSet: workerPods }],
						ports: [{ port: 6379, protocol: "TCP" }],
					},
				],
			});

			return [deployment, service, netpol];
		}),
	});
