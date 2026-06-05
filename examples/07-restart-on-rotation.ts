import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { RenderContext, Yaml } from "@konfig.ts/core";
import { SecretSource } from "@konfig.ts/env";
import { ExternalSecrets } from "@konfig.ts/external-secrets";
import { hashSecretValues, Secret, Workload } from "@konfig.ts/k8s";
import { Effect } from "effect";

const sessionKey = Secret.define({
	name: "session-key",
	namespace: "prod",
	env: { value: "SESSION_KEY" },
});

const sessionKeyK8s = Secret.bind({
	secret: sessionKey,
	backend: ExternalSecrets.backend({
		secretStoreRef: { name: "aws-prod", kind: "ClusterSecretStore" },
		remoteRef: () => ({ key: "prod/api/session-key" }),
	}),
	source: SecretSource.literal({ data: { value: "dev-stub-key" } }),
});

const program = Effect.gen(function* () {
	const ctx = RenderContext.make("prod");

	const sessionValues = yield* sessionKeyK8s.values!;
	const sessionHash = hashSecretValues({ values: sessionValues });

	const api = Workload.web({
		name: "api",
		namespace: "prod",
		deployment: {
			podAnnotations: { "konfig.ts/session-key-hash": sessionHash },
			containers: [
				{
					name: "api",
					image: "ghcr.io/example/api:1.0",
					ports: [{ containerPort: 8080 }],
					env: sessionKeyK8s.envVars,
				},
			],
		},
		service: { ports: [{ port: 80, targetPort: 8080 }] },
	});

	yield* Effect.log(`session-key build-time hash: ${sessionHash}`);
	yield* Effect.log("=== ExternalSecret ===");
	yield* Effect.log(`${Yaml.serialize({ value: yield* sessionKeyK8s.manifest!.render(ctx) })}---`);
	yield* Effect.log("=== Deployment + Service ===");
	const [deployment, service] = yield* api.render(ctx);
	for (const r of [deployment, service]) {
		yield* Effect.log(`${Yaml.serialize({ value: r })}---`);
	}
}).pipe(Effect.provide(sessionKeyK8s.layer!));

NodeRuntime.runMain(program.pipe(Effect.scoped, Effect.provide(NodeServices.layer)));
