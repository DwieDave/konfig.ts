import { it } from "@effect/vitest"
import { Effect } from "effect"
import { describe, expect } from "vitest"
import { ConfigMapRef, SecretRef, ServiceAccountRef } from "./refs"

describe("branded refs (FR-4.4 — raw strings rejected at type level)", () => {
  it("constructors return the underlying string", () => {
    expect(SecretRef.of("api-creds")).toBe("api-creds")
    expect(ConfigMapRef.of("oauth-templates")).toBe("oauth-templates")
    expect(ServiceAccountRef.of("api")).toBe("api")
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

  it.effect("EnvVar.fromSecretForPod accepts refs from the matching pod namespace", () =>
    Effect.gen(function*() {
      const { EnvVar } = yield* Effect.promise(() => import("./env"))
      const { Secret } = yield* Effect.promise(() => import("./identity"))
      const dbCreds = Secret.make({
        name: "db-creds",
        namespace: "app",
        stringData: { url: "u" }
      })
      const env = EnvVar.fromSecretForPod({
        name: "DATABASE_URL",
        ref: dbCreds.ref,
        key: "url",
        podNamespace: "app"
      })
      expect(env.valueFrom?.secretKeyRef).toEqual({
        name: "db-creds",
        key: "url"
      })
    }))

  it.effect(
    "EnvVar.fromSecretForPod rejects refs from a different namespace at compile time",
    () =>
      Effect.gen(function*() {
        const { EnvVar } = yield* Effect.promise(() => import("./env"))
        const { Secret } = yield* Effect.promise(() => import("./identity"))
        const monCreds = Secret.make({
          name: "grafana",
          namespace: "monitoring",
          stringData: { token: "t" }
        })
        EnvVar.fromSecretForPod({
          name: "GRAFANA",
          // @ts-expect-error — SecretRef<*, *, "monitoring"> not assignable to SecretRef<*, *, "app">.
          ref: monCreds.ref,
          key: "token",
          podNamespace: "app"
        })

        // Escape hatch wires it through, runtime is unchanged.
        const escaped = SecretRef.unsafeReNamespace(monCreds.ref)
        const env = EnvVar.fromSecretForPod({
          name: "GRAFANA",
          ref: escaped,
          key: "token",
          podNamespace: "app"
        })
        expect(env.valueFrom?.secretKeyRef?.name).toBe("grafana")
      })
  )

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

  it.effect("volume from Secret rejects raw string", () =>
    Effect.gen(function*() {
      const { Volume } = yield* Effect.promise(() => import("./volume"))
      // @ts-expect-error — raw string for `ref` is not assignable to SecretRef.
      Volume.fromSecret({ name: "v", ref: "raw-string" })
      const v = Volume.fromSecret({ name: "v", ref: SecretRef.of("creds") })
      expect(v.secret?.secretName).toBe("creds")
    }))

  it.effect("volume from ConfigMap rejects raw string", () =>
    Effect.gen(function*() {
      const { Volume } = yield* Effect.promise(() => import("./volume"))
      // @ts-expect-error — raw string for `ref` is not assignable to ConfigMapRef.
      Volume.fromConfigMap({ name: "v", ref: "raw-string" })
      const v = Volume.fromConfigMap({ name: "v", ref: ConfigMapRef.of("cfg") })
      expect(v.configMap?.name).toBe("cfg")
    }))

  it.effect("Pod.imagePullSecret rejects raw string", () =>
    Effect.gen(function*() {
      const { Pod } = yield* Effect.promise(() => import("./container"))
      // @ts-expect-error — raw string is not assignable to SecretRef.
      Pod.imagePullSecret("raw-string")
      const ips = Pod.imagePullSecret(SecretRef.of("ghcr-pull"))
      expect(ips.name).toBe("ghcr-pull")
    }))

  it.effect("Ingress.tls rejects raw string", () =>
    Effect.gen(function*() {
      const { Ingress } = yield* Effect.promise(() => import("./network"))
      // @ts-expect-error — raw string is not assignable to SecretRef.
      Ingress.tls({ secretName: "raw-string" })
      const tls = Ingress.tls({ secretName: SecretRef.of("tls") })
      expect(tls.secretName).toBe("tls")
    }))
})
