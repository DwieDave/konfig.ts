// Compile-time assertions for cross-namespace coherence on SecretRef.
// `EnvVar.fromSecretForPod({ podNamespace, ref, ... })` rejects a ref whose
// namespace slot doesn't match the pod's, eliminating the
// "secret exists, pod can't read it" CrashLoopBackOff at deploy time.

import type { SecretRef, SecretRefNamespace } from "@konfig.ts/core";
import { EnvVar, Secret, SecretRef as SecretRefValue } from "@konfig.ts/k8s";

type Expect<T extends true> = T;
type Equal<X, Y> =
	(<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;

// 1 · Secret.make captures the namespace in the brand.
const dbCreds = Secret.make({
	name: "db-creds",
	namespace: "app",
	stringData: { url: "u", password: "p" },
});
type DbRef = typeof dbCreds.ref;
type _DbNs = Expect<Equal<SecretRefNamespace<DbRef>, "app">>;

const monitoringCreds = Secret.make({
	name: "grafana-token",
	namespace: "monitoring",
	stringData: { token: "..." },
});
type MonRef = typeof monitoringCreds.ref;
type _MonNs = Expect<Equal<SecretRefNamespace<MonRef>, "monitoring">>;

// 2 · Happy path — pod in "app", ref from a Secret in "app".
const _ok = EnvVar.fromSecretForPod({
	name: "DATABASE_URL",
	ref: dbCreds.ref,
	key: "url",
	podNamespace: "app",
});

// 3 · BROKEN — pod in "app", ref from a Secret in "monitoring".
const _crossNs = EnvVar.fromSecretForPod({
	name: "GRAFANA_TOKEN",
	// @ts-expect-error - SecretRef<*, *, "monitoring"> not assignable to SecretRef<*, *, "app">.
	ref: monitoringCreds.ref,
	key: "token",
	podNamespace: "app",
});

// 4 · BROKEN — pod in "monitoring", ref from a Secret in "app".
const _backwards = EnvVar.fromSecretForPod({
	name: "DB_URL",
	// @ts-expect-error - SecretRef<*, *, "app"> not assignable to SecretRef<*, *, "monitoring">.
	ref: dbCreds.ref,
	key: "url",
	podNamespace: "monitoring",
});

// 5 · Escape hatch — explicit opt-in for cross-namespace.
const escaped = SecretRefValue.unsafeReNamespace(monitoringCreds.ref);
const _escapeOk = EnvVar.fromSecretForPod({
	name: "GRAFANA_TOKEN",
	ref: escaped,
	key: "token",
	podNamespace: "app",
});

// 6 · Key narrowing still works across the extension. Typo'd key
//     is caught regardless of namespace.
const _keyTypo = EnvVar.fromSecretForPod({
	name: "DATABASE_PASSWORD",
	ref: dbCreds.ref,
	// @ts-expect-error - "passowrd" is not in "url" | "password".
	key: "passowrd",
	podNamespace: "app",
});

// 7 · Bare `SecretRef.of` (default Ns=string) needs explicit opt-out
//     via `unsafeReNamespace` to be usable in a typed pod context — the
//     brand is invariant in Ns, so the back-compat "any namespace"
//     case requires the same escape hatch as a legitimate
//     cross-namespace ref.
const opaque: SecretRef<"opaque"> = "opaque" as SecretRef<"opaque">;
const _anyPod = EnvVar.fromSecretForPod({
	name: "OPAQUE",
	ref: SecretRefValue.unsafeReNamespace(opaque),
	key: "anything",
	podNamespace: "some-pod",
});

void _ok;
void _crossNs;
void _backwards;
void _escapeOk;
void _keyTypo;
void _anyPod;

export type _Tests = readonly [_DbNs, _MonNs];
