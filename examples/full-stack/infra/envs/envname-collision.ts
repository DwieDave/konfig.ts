/**
 * Worked example of the type-level envName-collision check on
 * `defineEnvironment`.
 *
 * Adding two members that claim the same env var triggers a structured
 * compile error. The runtime throw stays as a defense-in-depth fallback
 * (it fires at module-load time if someone bypasses types).
 *
 * Not registered in konfig.json — pure typing regression.
 */
import {
  defineDownward,
  defineEnvironment,
  defineLiteral,
  defineSecret,
} from "@konfig.ts/env";

// Baseline: distinct envNames — no error.
const _ok = defineEnvironment({
  db: defineSecret({
    name: "db-creds",
    namespace: "app",
    env: { url: "DATABASE_URL", password: "DATABASE_PASSWORD" },
  }),
  port: defineLiteral({ envName: "PORT", value: 8080 }),
  pod: defineDownward({ envName: "POD_NAME", fieldPath: "metadata.name" }),
});
void _ok;

// (1) Two literals share `SHARED` — direct collision.
// @ts-expect-error envName "SHARED" is claimed by multiple members
const _literalDup = defineEnvironment({
  a: defineLiteral({ envName: "SHARED", value: "x" }),
  b: defineLiteral({ envName: "SHARED", value: "y" }),
});
void _literalDup;

// (2) Literal collides with a secret env value.
// @ts-expect-error envName "DATABASE_URL" is claimed by multiple members
const _secretLiteralDup = defineEnvironment({
  db: defineSecret({
    name: "db",
    namespace: "app",
    env: { url: "DATABASE_URL" },
  }),
  shadow: defineLiteral({ envName: "DATABASE_URL", value: "x" }),
});
void _secretLiteralDup;

// (3) Two secrets claim the same envName via different keys.
// @ts-expect-error envName "SHARED" is claimed by multiple members
const _secretSecretDup = defineEnvironment({
  a: defineSecret({ name: "a", namespace: "app", env: { url: "SHARED" } }),
  b: defineSecret({ name: "b", namespace: "app", env: { val: "SHARED" } }),
});
void _secretSecretDup;
