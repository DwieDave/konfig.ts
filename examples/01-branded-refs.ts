// Example 1 — Branded references
//
// `@konfig.ts/k8s` brands the *name* of every Secret / ConfigMap /
// ServiceAccount / PVC into the type of its reference. So a
// `SecretRef<"db-creds">` is structurally distinct from a `SecretRef<
// "other">` even though both are plain strings at runtime.
//
// The payoff: the six places a workload spec dereferences another
// resource by name (env var secretKeyRef + configMapKeyRef, volume
// secret + configMap, imagePullSecret, Ingress TLS) accept ONLY a
// branded ref — raw strings are rejected at the type signature. You
// can't ship a Deployment that references a Secret that doesn't exist
// in the same module, because there's no way to produce the brand
// without going through `Secret.make(...).ref` (or the corresponding
// `yield* Dep.Secret(name)` for cross-module deps).
//
// Run: bun examples/01-branded-refs.ts

import { BunRuntime, BunServices } from "@effect/platform-bun";
import { RenderContext, Yaml } from "@konfig.ts/core";
import { Secret, secretEnv, valueEnv, Workload } from "@konfig.ts/k8s";
import { Effect } from "effect";

// `Secret.make` returns a Manifest plus a typed `.ref`. The literal
// "db-creds" is preserved in the ref's type: `SecretRef<"db-creds">`.
const dbCreds = Secret.make({
	name: "db-creds",
	namespace: "prod",
	stringData: { url: "postgres://api@db.prod/api" },
});

// The Deployment references the Secret via `dbCreds.ref` — the brand
// flows through `secretEnv` without us ever restating the name.
const api = Workload.web({
	name: "api",
	namespace: "prod",
	deployment: {
		replicas: 2,
		containers: [
			{
				name: "api",
				image: "ghcr.io/example/api:1.0",
				ports: [{ containerPort: 8080 }],
				env: [
					valueEnv("PORT", "8080"),
					secretEnv("DATABASE_URL", { ref: dbCreds.ref, key: "url" }),
				],
			},
		],
	},
	service: { ports: [{ port: 80, targetPort: 8080 }] },
});

// ── What the type system rejects ───────────────────────────────────
//
// Each `@ts-expect-error` line below WOULD fail to compile if it
// weren't suppressed. Uncomment the suppression to see the diagnostic.

// @ts-expect-error  raw string is not a SecretRef — rejected at signature
secretEnv("FOO", { ref: "db-creds", key: "url" });

// @ts-expect-error  names are in the type — a ref to "other" can't be
// assigned where a ref to "db-creds" is expected.
const _wrong: typeof dbCreds.ref = Secret.make({
	name: "other",
	namespace: "prod",
	stringData: {},
}).ref;

// ── Render the manifests and print as YAML ─────────────────────────

const program = Effect.gen(function* () {
	const ctx = RenderContext.make("prod");
	const secret = yield* dbCreds.render(ctx);
	const [deployment, service] = yield* api.render(ctx);
	for (const r of [secret, deployment, service]) {
		process.stdout.write(Yaml.serialize(r));
		process.stdout.write("---\n");
	}
});

BunRuntime.runMain(program.pipe(Effect.scoped, Effect.provide(BunServices.layer)));
