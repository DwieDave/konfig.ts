import { defineSecret } from "@konfig.ts/env";

/**
 * Postgres connection credentials.
 *
 * Used by both `apps/api` (read+write) and `apps/worker` (background
 * jobs). The two consumers share the same Secret — they need identical
 * connection strings, and rotating once should rotate everywhere.
 *
 * Backend is bound per-environment (prod = SOPS-encrypted yaml on disk,
 * staging could use a different recipient, local would skip the manifest
 * and let devspace populate plaintext out-of-band). The bundle itself
 * stays storage-agnostic.
 */
export const dbCreds = defineSecret({
	name: "db-creds",
	namespace: "app",
	env: {
		url: "DATABASE_URL",
		username: "DATABASE_USER",
		password: "DATABASE_PASSWORD",
	},
});

/**
 * S3 access for the api's media uploads. Only the api consumes this.
 */
export const s3Creds = defineSecret({
	name: "s3-creds",
	namespace: "app",
	env: {
		accessKey: "S3_ACCESS_KEY_ID",
		secretKey: "S3_SECRET_ACCESS_KEY",
	},
});

/**
 * JWT signing key. Only the api needs it (worker doesn't issue tokens).
 */
export const jwtKey = defineSecret({
	name: "jwt-signing-key",
	namespace: "app",
	env: {
		key: "JWT_SIGNING_KEY",
	},
});

/**
 * GHCR docker pull credential. Mounted as a Kubernetes
 * `imagePullSecrets` entry, NOT exposed to the container as env vars.
 *
 * This contract is provided by `infra/modules/image-pulls.ts` via
 * `Secret.bind` (no Environment binding — the secret has no env-var
 * mappings beyond the dockerconfigjson blob itself).
 */
export const ghcrPull = defineSecret({
	name: "ghcr-pull",
	namespace: "app",
	env: {
		dockerconfigjson: ".dockerconfigjson",
	},
});
