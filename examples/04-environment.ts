import { NodeRuntime, NodeServices } from "@effect/platform-node";
import {
	Downward,
	Literal,
	Secret,
	SecretSource,
} from "@konfig.ts/env";
import { Environment, Workload } from "@konfig.ts/k8s";
import { RenderContext, Yaml } from "@konfig.ts/core";
import { ConfigProvider, Context, Effect, Layer, Redacted } from "effect";

const dbCreds = Secret.define({
	name: "db-creds",
	namespace: "prod",
	env: { url: "DATABASE_URL", password: "DATABASE_PASSWORD" },
});

const sessionKey = Secret.define({
	name: "session-key",
	namespace: "prod",
	env: { value: "SESSION_KEY" },
});

const port = Literal.define({ envName: "PORT", value: 8080 });
const podName = Downward.define({ envName: "POD_NAME", fieldPath: "metadata.name" });

const apiEnv = Environment.define({
	db: dbCreds,
	session: sessionKey,
	port,
	pod: podName,
});

// Environment.bind enforces that every secret in apiEnv is provided
// here — adding a new Secret to the bundle forces this call to
// supply either a `backend` or a `source` for it. The source-only path
// is what test/local renders use; production renders pair the source
// with a `backend` so a Secret manifest is emitted (see example 05).
const apiEnvK8s = Environment.bind({
	env: apiEnv,
	secrets: {
		db: {
			source: SecretSource.literal({
				data: { url: "postgres://localhost/api", password: "hunter2" },
			}),
		},
		session: {
			source: SecretSource.literal({ data: { value: "sig" } }),
		},
	},
});

const api = Workload.web({
	name: "api",
	namespace: "prod",
	deployment: {
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

const _dbRefString: string = apiEnvK8s.members.db.ref;
const _portValue: number = apiEnvK8s.members.port.value;
const _podFieldPath: string = apiEnvK8s.members.pod.fieldPath;
void _dbRefString;
void _portValue;
void _podFieldPath;

const renderManifests = Effect.gen(function* () {
	const ctx = RenderContext.make("prod");
	const [deployment, service] = yield* api.render(ctx);
	for (const r of [deployment, service]) {
		yield* Effect.log(`${Yaml.serialize({ value: r })}---`);
	}
});

const podMainBundle = Effect.gen(function* () {
	const env = yield* apiEnv;
	yield* Effect.log(`port from bundle: ${env.port}`);
	yield* Effect.log(`pod from bundle:  ${env.pod}`);
	yield* Effect.log(`db.url is Redacted: ${String(env.db.url)}`);
});

interface DbClientShape {
	readonly query: (sql: string) => Effect.Effect<string>;
}
const DbClient = Context.Service<DbClientShape>("DbClient");
const DbClientLive = Layer.effect(
	DbClient,
	Effect.gen(function* () {
		const creds = yield* dbCreds;
		const fakeUrl = Redacted.value(creds.url);
		return {
			query: (sql: string) => Effect.succeed(`[${fakeUrl}] ran: ${sql}`),
		};
	}),
);

const podMainSubAtom = Effect.gen(function* () {
	const url = yield* dbCreds.fields.url;
	yield* Effect.log(`db.url sub-config: ${String(url)} (Redacted)`);
});

const fakeEnv = ConfigProvider.layer(
	ConfigProvider.fromUnknown({
		DATABASE_URL: "postgres://localhost/api",
		DATABASE_PASSWORD: "hunter2",
		SESSION_KEY: "sig",
		POD_NAME: "api-7c9d8",
	}),
);

const program = Effect.gen(function* () {
	yield* Effect.log("=== manifests ===");
	yield* renderManifests;
	yield* Effect.log("=== pod side (a) bundle ===");
	yield* podMainBundle;
	yield* Effect.log("=== pod side (b) atom layer ===");
	const db = yield* DbClient;
	yield* Effect.log(yield* db.query("select 1"));
	yield* Effect.log("=== pod side (c) sub-atom ===");
	yield* podMainSubAtom;
});

const AppLayer = Layer.mergeAll(DbClientLive.pipe(Layer.provide(fakeEnv)), fakeEnv);

NodeRuntime.runMain(
	program.pipe(
		Effect.provide(AppLayer),
		Effect.scoped,
		Effect.provide(NodeServices.layer),
	),
);
