// Demonstrates: `Environment.bind` enforcing secret coverage at compile time.
import { apiEnv } from "@example/env-contracts"
import { Environment } from "@konfig.ts/k8s"
import { Sops } from "@konfig.ts/sops"

const sopsBase = "infra/secrets"
const dbBackend = Sops.passthrough({
  file: `${sopsBase}/SopsSecret-db-creds.yaml`
})
const s3Backend = Sops.passthrough({
  file: `${sopsBase}/SopsSecret-s3-creds.yaml`
})
const jwtBackend = Sops.passthrough({
  file: `${sopsBase}/SopsSecret-jwt-signing-key.yaml`
})

const _ok = Environment.bind({
  env: apiEnv,
  namespace: "app",
  secrets: {
    db: { backend: dbBackend },
    s3: { backend: s3Backend },
    jwt: { backend: jwtBackend }
  }
})
void _ok

// @ts-expect-error Property 'secrets' is missing
const _missingSecretsField = Environment.bind({
  env: apiEnv,
  namespace: "app"
})
void _missingSecretsField

const _missingJwt = Environment.bind({
  env: apiEnv,
  namespace: "app",
  // @ts-expect-error Property 'jwt' is missing
  secrets: {
    db: { backend: dbBackend },
    s3: { backend: s3Backend }
  }
})
void _missingJwt

const _emptyDb = Environment.bind({
  env: apiEnv,
  namespace: "app",
  secrets: {
    // @ts-expect-error Property 'backend' or 'source' is missing
    db: {},
    s3: { backend: s3Backend },
    jwt: { backend: jwtBackend }
  }
})
void _emptyDb

// `Sops.backend` requires a `source` at the type level.
const sopsBackend = Sops.backend({
  recipients: {
    age: ["age1demo000000000000000000000000000000000000000000000000000example"]
  }
})
const _missingSource = Environment.bind({
  env: apiEnv,
  namespace: "app",
  secrets: {
    // @ts-expect-error Property 'source' is missing for a requiresSource backend
    db: { backend: sopsBackend },
    s3: { backend: s3Backend },
    jwt: { backend: jwtBackend }
  }
})
void _missingSource
