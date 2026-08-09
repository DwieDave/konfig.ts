import { Secret } from "@konfig.ts/env"

// Shared by api and worker so rotating once rotates everywhere.
export const dbCreds = Secret.define({
  name: "db-creds",
  namespace: "app",
  env: {
    url: "DATABASE_URL",
    username: "DATABASE_USER",
    password: "DATABASE_PASSWORD"
  }
})

export const s3Creds = Secret.define({
  name: "s3-creds",
  namespace: "app",
  env: {
    accessKey: "S3_ACCESS_KEY_ID",
    secretKey: "S3_SECRET_ACCESS_KEY"
  }
})

export const jwtKey = Secret.define({
  name: "jwt-signing-key",
  namespace: "app",
  env: {
    key: "JWT_SIGNING_KEY"
  }
})

// Mounted as imagePullSecrets, not exposed to the container as env vars.
export const ghcrPull = Secret.define({
  name: "ghcr-pull",
  namespace: "app",
  env: {
    dockerconfigjson: ".dockerconfigjson"
  }
})
