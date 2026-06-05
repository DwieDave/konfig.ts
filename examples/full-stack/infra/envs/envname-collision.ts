/**
 * Worked example of the type-level envName-collision check on
 * `Environment`.
 *
 * Adding two members that claim the same env var triggers a structured
 * compile error. The runtime throw stays as a defense-in-depth fallback
 * (it fires at module-load time if someone bypasses types).
 *
 * Not registered in konfig.json — pure typing regression.
 */
import {
  Downward,
  Environment,
  Literal,
  Secret,
} from "@konfig.ts/env";

// Baseline: distinct envNames — no error.
const _ok = Environment.define({
  db: Secret.define({
    name: "db-creds",
    namespace: "app",
    env: { url: "DATABASE_URL", password: "DATABASE_PASSWORD" },
  }),
  port: Literal.define({ envName: "PORT", value: 8080 }),
  pod: Downward.define({ envName: "POD_NAME", fieldPath: "metadata.name" }),
});
void _ok;

// (1) Two literals share `SHARED` — direct collision.
// @ts-expect-error envName "SHARED" is claimed by multiple members
const _literalDup = Environment.define({
  a: Literal.define({ envName: "SHARED", value: "x" }),
  b: Literal.define({ envName: "SHARED", value: "y" }),
});
void _literalDup;

// (2) Literal collides with a secret env value.
// @ts-expect-error envName "DATABASE_URL" is claimed by multiple members
const _secretLiteralDup = Environment.define({
  db: Secret.define({
    name: "db",
    namespace: "app",
    env: { url: "DATABASE_URL" },
  }),
  shadow: Literal.define({ envName: "DATABASE_URL", value: "x" }),
});
void _secretLiteralDup;

// (3) Two secrets claim the same envName via different keys.
// @ts-expect-error envName "SHARED" is claimed by multiple members
const _secretSecretDup = Environment.define({
  a: Secret.define({ name: "a", namespace: "app", env: { url: "SHARED" } }),
  b: Secret.define({ name: "b", namespace: "app", env: { val: "SHARED" } }),
});
void _secretSecretDup;
