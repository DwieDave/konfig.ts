import { Application } from "@konfig.ts/argocd";
import { Dep } from "@konfig.ts/core";
import { Environment, Workload } from "@konfig.ts/k8s";
import { Sops } from "@konfig.ts/sops";
import { apiEnv } from "@example/env-contracts";
import { Effect } from "effect";

export interface ApiOptions {
  readonly source: Application.ArgoSource;
  readonly image: string;
  readonly replicas: number;
  readonly sopsBase: string;
}

/**
 * `apps/api` workload module.
 *
 * Demonstrates the env-contract -> manifest binding:
 *   - `Environment.bind` walks `apiEnv` and, for each secret member,
 *     calls the supplied backend's `emit` to produce the SopsSecret
 *     manifest, while wiring `secretKeyRef` env vars into the container.
 *   - `Sops.passthrough` reuses the encrypted yaml on disk, so no
 *     `sops` shell-out at render time.
 *
 * Type-level dependency: the `yield* Dep.Secret("ghcr-pull")` line
 * makes this module require a provider for "ghcr-pull" in the
 * composition layer. envs/prod.ts gets a type error if `image-pulls`
 * isn't merged into the provided layer.
 */
export const defineApi = (opts: ApiOptions) =>
  Application.define({
    name: "api",
    namespace: "app",
    source: opts.source,
    build: Effect.gen(function* () {
      const ghcrRef = yield* Dep.Secret("ghcr-pull");

      const bound = Environment.bind({
        env: apiEnv,
        namespace: "app",
        secrets: {
          db: {
            backend: Sops.passthrough({
              file: `${opts.sopsBase}/SopsSecret-db-creds.yaml`,
            }),
          },
          s3: {
            backend: Sops.passthrough({
              file: `${opts.sopsBase}/SopsSecret-s3-creds.yaml`,
            }),
          },
          jwt: {
            backend: Sops.passthrough({
              file: `${opts.sopsBase}/SopsSecret-jwt-signing-key.yaml`,
            }),
          },
        },
      });

      const workload = Workload.web({
        name: "api",
        namespace: "app",
        deployment: {
          replicas: opts.replicas,
          imagePullSecrets: [{ name: ghcrRef }],
          containers: [
            {
              name: "api",
              image: opts.image,
              ports: [{ containerPort: 8080 }],
              env: bound.envVars,
              readinessProbe: {
                httpGet: { path: "/healthz", port: 8080 },
                periodSeconds: 5,
              },
            },
          ],
        },
        service: {
          ports: [{ port: 80, targetPort: 8080 }],
        },
      });

      return [...bound.manifests, workload];
    }),
  });
