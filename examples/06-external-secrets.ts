import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { RenderContext, Yaml } from "@konfig.ts/core";
import { defineEnvironment, defineLiteral, defineSecret } from "@konfig.ts/env";
import { ExternalSecrets } from "@konfig.ts/external-secrets";
import { Environment, Secret, Workload } from "@konfig.ts/k8s";
import { Effect } from "effect";

const dbCreds = defineSecret({
	name: "db-creds",
	namespace: "prod",
	env: { url: "DATABASE_URL", password: "DATABASE_PASSWORD" },
});

const sessionKey = defineSecret({
	name: "session-key",
	namespace: "prod",
	env: { value: "SESSION_KEY" },
});

const port = defineLiteral({ envName: "PORT", value: 8080 });

const apiEnv = defineEnvironment({ db: dbCreds, session: sessionKey, port });

const apiEnvK8s = Environment.bind({
	env: apiEnv,
	secrets: {
		db: {
			backend: ExternalSecrets.backend<"db-creds", "url" | "password">({
				secretStoreRef: { name: "aws-prod", kind: "ClusterSecretStore" },
				refreshInterval: "1h",
				remoteRef: (key) => ({ key: `prod/api/${key}` }),
			}),
		},
		session: {
			backend: ExternalSecrets.backend({
				secretStoreRef: { name: "aws-prod", kind: "ClusterSecretStore" },
				remoteRef: () => ({ key: "prod/api/session-key" }),
			}),
		},
	},
});

const ghcrPull = defineSecret({
	name: "ghcr-pull",
	namespace: "infra",
	env: { dockerconfig: "DOCKERCONFIGJSON" },
});

const ghcrPullK8s = Secret.bind({
	secret: ghcrPull,
	backend: ExternalSecrets.backend({
		secretStoreRef: { name: "aws-prod", kind: "ClusterSecretStore" },
		remoteRef: () => ({ key: "prod/ghcr/dockerconfigjson" }),
	}),
});

const api = Workload.web({
	name: "api",
	namespace: "prod",
	deployment: {
		imagePullSecrets: [{ name: ghcrPullK8s.ref }],
		containers: [
			{
				name: "api",
				image: "ghcr.io/example/api:1.0",
				ports: [{ containerPort: 8080 }],
				env: apiEnvK8s.envVars,
			},
		],
	},
	service: { ports: [{ port: 80, targetPort: 8080 }] },
});

const program = Effect.gen(function* () {
	const ctx = RenderContext.make("prod");
	yield* Effect.log("=== ExternalSecret CRs (from Environment.bind) ===");
	for (const m of apiEnvK8s.manifests) {
		const rendered = yield* m.render(ctx);
		yield* Effect.log(`${Yaml.serialize({ value: rendered })}---`);
	}
	yield* Effect.log("=== Standalone ExternalSecret (image pull) ===");
	const ghcr = yield* ghcrPullK8s.manifest!.render(ctx);
	yield* Effect.log(`${Yaml.serialize({ value: ghcr })}---`);
	yield* Effect.log("=== Workload manifests ===");
	const [deployment, service] = yield* api.render(ctx);
	for (const r of [deployment, service]) {
		yield* Effect.log(`${Yaml.serialize({ value: r })}---`);
	}
});

NodeRuntime.runMain(program.pipe(Effect.scoped, Effect.provide(NodeServices.layer)));
