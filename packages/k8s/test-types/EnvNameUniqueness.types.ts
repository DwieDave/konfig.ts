// Compile-time assertions for env-name duplicate detection on
// `Container.define({ env })`. K8s last-wins on duplicate env names —
// surfacing them at the call site replaces a silent runtime bug with
// a `_konfig_duplicate_env_names` hint sentence.

import { Container, EnvVar, Port } from "@konfig.ts/k8s";

// 1 · Happy path — three distinct env names.
const _good = Container.define({
	name: "api",
	image: "ghcr.io/example/api:1.0.0",
	ports: [Port.make({ name: "http", containerPort: 8080 })],
	env: [
		EnvVar.value({ name: "PORT", value: "8080" }),
		EnvVar.value({ name: "LOG_LEVEL", value: "info" }),
		EnvVar.value({ name: "DB_URL", value: "postgres://..." }),
	],
});

// 2 · BROKEN — "PORT" appears twice; the env-dup hint sentence
//     surfaces inline in the TS error.
const _dup = Container.define({
	name: "api",
	image: "x",
	ports: [Port.make({ name: "http", containerPort: 8080 })],
	// @ts-expect-error - _konfig_duplicate_env_names: "PORT" declared twice.
	env: [
		EnvVar.value({ name: "PORT", value: "8080" }),
		EnvVar.value({ name: "LOG_LEVEL", value: "info" }),
		EnvVar.value({ name: "PORT", value: "9090" }),
	],
});

// 3 · BROKEN — two pairs of duplicates; both names appear in the
//     sentence's union.
const _dups = Container.define({
	name: "api",
	image: "x",
	ports: [Port.make({ name: "http", containerPort: 8080 })],
	// @ts-expect-error - _konfig_duplicate_env_names: "PORT" and "LOG_LEVEL" each twice.
	env: [
		EnvVar.value({ name: "PORT", value: "8080" }),
		EnvVar.value({ name: "LOG_LEVEL", value: "info" }),
		EnvVar.value({ name: "PORT", value: "9090" }),
		EnvVar.value({ name: "LOG_LEVEL", value: "debug" }),
	],
});

// 4 · Empty env / no env — degenerate case, ok.
const _empty = Container.define({
	name: "api",
	image: "x",
	ports: [Port.make({ name: "http", containerPort: 8080 })],
});

const _emptyArr = Container.define({
	name: "api",
	image: "x",
	ports: [Port.make({ name: "http", containerPort: 8080 })],
	env: [],
});

void _good;
void _dup;
void _dups;
void _empty;
void _emptyArr;
