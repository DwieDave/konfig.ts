/**
 * Worked example of `Environment.bind` enforcing secret coverage at
 * compile time.
 *
 * `apiEnv` declares `db`, `s3`, and `jwt` as secrets. Each call below
 * removes or weakens one of them and the @ts-expect-error directive
 * asserts that the type system flags the gap.
 *
 * Not registered in konfig.json — this file exists purely as a typing
 * regression check (run `bun check`).
 */
import { Environment } from "@konfig.ts/k8s";
import { Sops } from "@konfig.ts/sops";
import { apiEnv } from "@example/env-contracts";

const sopsBase = "infra/secrets";
const dbBackend = Sops.passthrough({ file: `${sopsBase}/SopsSecret-db-creds.yaml` });
const s3Backend = Sops.passthrough({ file: `${sopsBase}/SopsSecret-s3-creds.yaml` });
const jwtBackend = Sops.passthrough({ file: `${sopsBase}/SopsSecret-jwt-signing-key.yaml` });

// Baseline: every secret bound — no error.
const _ok = Environment.bind({
	env: apiEnv,
	namespace: "app",
	secrets: {
		db: { backend: dbBackend },
		s3: { backend: s3Backend },
		jwt: { backend: jwtBackend },
	},
});
void _ok;

// (1) Whole `secrets` field omitted — required when M has secrets.
// @ts-expect-error Property 'secrets' is missing
const _missingSecretsField = Environment.bind({
	env: apiEnv,
	namespace: "app",
});
void _missingSecretsField;

// (2) `jwt` member omitted — every secret must be present.
const _missingJwt = Environment.bind({
	env: apiEnv,
	namespace: "app",
	// @ts-expect-error Property 'jwt' is missing
	secrets: {
		db: { backend: dbBackend },
		s3: { backend: s3Backend },
	},
});
void _missingJwt;

// (3) `db` member present but neither backend nor source — at least
// one must be supplied so a Secret manifest or in-process values layer
// actually backs the `secretKeyRef` envVars.
const _emptyDb = Environment.bind({
	env: apiEnv,
	namespace: "app",
	secrets: {
		// @ts-expect-error Property 'backend' or 'source' is missing
		db: {},
		s3: { backend: s3Backend },
		jwt: { backend: jwtBackend },
	},
});
void _emptyDb;
