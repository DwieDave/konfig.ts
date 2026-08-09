import { Container, EnvVar, Port } from "@konfig.ts/k8s"

const _good = Container.define({
  name: "api",
  image: "ghcr.io/example/api:1.0.0",
  ports: [Port.make({ name: "http", containerPort: 8080 })],
  env: [
    EnvVar.value({ name: "PORT", value: "8080" }),
    EnvVar.value({ name: "LOG_LEVEL", value: "info" }),
    EnvVar.value({ name: "DB_URL", value: "postgres://..." })
  ]
})

const _dup = Container.define({
  name: "api",
  image: "x",
  ports: [Port.make({ name: "http", containerPort: 8080 })],
  // @ts-expect-error - _konfig_duplicate_env_names: "PORT" declared twice.
  env: [
    EnvVar.value({ name: "PORT", value: "8080" }),
    EnvVar.value({ name: "LOG_LEVEL", value: "info" }),
    EnvVar.value({ name: "PORT", value: "9090" })
  ]
})

const _dups = Container.define({
  name: "api",
  image: "x",
  ports: [Port.make({ name: "http", containerPort: 8080 })],
  // @ts-expect-error - _konfig_duplicate_env_names: "PORT" and "LOG_LEVEL" each twice.
  env: [
    EnvVar.value({ name: "PORT", value: "8080" }),
    EnvVar.value({ name: "LOG_LEVEL", value: "info" }),
    EnvVar.value({ name: "PORT", value: "9090" }),
    EnvVar.value({ name: "LOG_LEVEL", value: "debug" })
  ]
})

const _empty = Container.define({
  name: "api",
  image: "x",
  ports: [Port.make({ name: "http", containerPort: 8080 })]
})

const _emptyArr = Container.define({
  name: "api",
  image: "x",
  ports: [Port.make({ name: "http", containerPort: 8080 })],
  env: []
})

void _good
void _dup
void _dups
void _empty
void _emptyArr
