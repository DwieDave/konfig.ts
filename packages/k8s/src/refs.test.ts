import { it } from "@effect/vitest"
import { Effect } from "effect"
import { describe, expect } from "vitest"
import { ConfigMapRef, SecretRef } from "./refs"

describe("branded refs (FR-4.4 — raw strings rejected at type level)", () => {
  it("constructors return the underlying string", () => {
    expect(SecretRef.of("api-creds")).toBe("api-creds")
    expect(ConfigMapRef.of("oauth-templates")).toBe("oauth-templates")
  })

  it.effect("env-var (secretKeyRef) rejects raw string", () =>
    Effect.gen(function*() {
      const { EnvVar } = yield* Effect.promise(() => import("./env"))
      // @ts-expect-error — raw string for `ref` is not assignable to SecretRef.
      EnvVar.fromSecret({ name: "API_KEY", ref: "raw-string", key: "k" })

      const env = EnvVar.fromSecret({
        name: "API_KEY",
        ref: SecretRef.of("api-creds"),
        key: "k"
      })

      expect(env.valueFrom?.secretKeyRef?.name).toBe("api-creds")
    }))

  it.effect("env-var with a keyed SecretRef rejects keys not in the declared union", () =>
    Effect.gen(function*() {
      const { EnvVar } = yield* Effect.promise(() => import("./env"))
      const ref = SecretRef.of<"db-creds", "url" | "password">("db-creds")
      // @ts-expect-error — "passowrd" is not in "url" | "password".
      EnvVar.fromSecret({ name: "DATABASE_PASSWORD", ref, key: "passowrd" })
      const env = EnvVar.fromSecret({ name: "DATABASE_PASSWORD", ref, key: "password" })
      expect(env.valueFrom?.secretKeyRef?.key).toBe("password")
    }))

  it.effect("EnvVar.secretEnv accepts refs from the matching pod namespace", () =>
    Effect.gen(function*() {
      const { EnvVar } = yield* Effect.promise(() => import("./env"))
      const { Secret } = yield* Effect.promise(() => import("./identity"))

      const dbCreds = Secret.make({ name: "db-creds", namespace: "app", stringData: { url: "u" } })

      const [env] = EnvVar.secretEnv({ ref: dbCreds.ref, map: { DATABASE_URL: "url" }, podNamespace: "app" })

      expect(env?.valueFrom?.secretKeyRef).toEqual({ name: "db-creds", key: "url" })
    }))

  it.effect("EnvVar.secretEnv rejects refs from a different namespace at compile time", () =>
    Effect.gen(function*() {
      const { EnvVar } = yield* Effect.promise(() => import("./env"))
      const { Secret } = yield* Effect.promise(() => import("./identity"))

      const monCreds = Secret.make({ name: "grafana", namespace: "monitoring", stringData: { token: "t" } })

      const [env] = EnvVar.secretEnv({
        ref: monCreds.ref,
        map: { GRAFANA: "token" },
        // @ts-expect-error — podNamespace "app" does not match the ref's namespace "monitoring".
        podNamespace: "app"
      })

      expect(env?.valueFrom?.secretKeyRef?.name).toBe("grafana")
    }))

  it.effect("env-var (configMapKeyRef) rejects raw string", () =>
    Effect.gen(function*() {
      const { EnvVar } = yield* Effect.promise(() => import("./env"))
      // @ts-expect-error — raw string for `ref` is not assignable to ConfigMapRef.
      EnvVar.fromConfigMap({ name: "CFG", ref: "raw-string", key: "k" })

      const env = EnvVar.fromConfigMap({
        name: "CFG",
        ref: ConfigMapRef.of("cfg"),
        key: "k"
      })

      expect(env.valueFrom?.configMapKeyRef?.name).toBe("cfg")
    }))

  it.effect("env-var with a keyed ConfigMapRef rejects keys not in the declared union", () =>
    Effect.gen(function*() {
      const { EnvVar } = yield* Effect.promise(() => import("./env"))
      const ref = ConfigMapRef.of<"app-config", "HOST" | "PORT">("app-config")
      // @ts-expect-error — "PROT" is not in "HOST" | "PORT".
      EnvVar.fromConfigMap({ name: "DB_PORT", ref, key: "PROT" })
      const env = EnvVar.fromConfigMap({ name: "DB_PORT", ref, key: "PORT" })
      expect(env.valueFrom?.configMapKeyRef?.key).toBe("PORT")
    }))
})
