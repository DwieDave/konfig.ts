# konfig-managed: @konfig.ts/docker
# spec: examples/full-stack/apps/api/docker.ts
# hash: sha256:3d0284bd27ce458e6b21e768d5370c37e4dbb1e9a14fda70047aaf4e98f3c5d3
FROM oven/bun:1.3.5-alpine AS base

FROM base AS deps
WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
COPY examples/full-stack/apps/api/package.json ./examples/full-stack/apps/api/
COPY examples/full-stack/shared/env-contracts/package.json ./examples/full-stack/shared/env-contracts/
COPY examples/full-stack/apps/worker/package.json ./examples/full-stack/apps/worker/
COPY packages/argocd/package.json ./packages/argocd/
COPY packages/cli/package.json ./packages/cli/
COPY packages/core/package.json ./packages/core/
COPY packages/docker/package.json ./packages/docker/
COPY packages/env/package.json ./packages/env/
COPY examples/full-stack/package.json ./examples/full-stack/
COPY examples/package.json ./examples/
COPY packages/external-secrets/package.json ./packages/external-secrets/
COPY packages/k8s/package.json ./packages/k8s/
COPY packages/oxc/package.json ./packages/oxc/
COPY packages/sealed-secrets/package.json ./packages/sealed-secrets/
COPY packages/sops/package.json ./packages/sops/
RUN bun install --ignore-scripts

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules /app/node_modules
COPY --from=deps /app/packages/core/node_modules /app/packages/core/node_modules
COPY --from=deps /app/packages/env/node_modules /app/packages/env/node_modules
COPY --from=deps /app/examples/full-stack/shared/env-contracts/node_modules /app/examples/full-stack/shared/env-contracts/node_modules
COPY --from=deps /app/examples/full-stack/apps/api/node_modules /app/examples/full-stack/apps/api/node_modules
COPY packages/core ./packages/core
COPY packages/env ./packages/env
COPY examples/full-stack/shared/env-contracts ./examples/full-stack/shared/env-contracts
COPY examples/full-stack/apps/api ./examples/full-stack/apps/api
WORKDIR /app/examples/full-stack/apps/api

FROM base AS prod-deps
WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
RUN bun -e 'const fs=require("fs"); const p=JSON.parse(fs.readFileSync("package.json","utf-8")); p.workspaces=["examples/full-stack/apps/api","examples/full-stack/shared/env-contracts","packages/core","packages/env"]; delete p.devDependencies; fs.writeFileSync("package.json", JSON.stringify(p,null,2));'
RUN rm -f bun.lock
COPY packages/core/package.json ./packages/core/
COPY packages/env/package.json ./packages/env/
COPY examples/full-stack/shared/env-contracts/package.json ./examples/full-stack/shared/env-contracts/
COPY examples/full-stack/apps/api/package.json ./examples/full-stack/apps/api/
RUN bun install --ignore-scripts --production

FROM base AS runner
WORKDIR /app/apps/api
RUN addgroup -S -g 1001 app && adduser -S -u 1001 -G app app
ENV LOG_LEVEL=info NODE_ENV=production
EXPOSE 8080
COPY --from=prod-deps --chown=app:app /app/node_modules /app/node_modules
COPY --from=builder --chown=app:app /app/packages/core /app/packages/core
COPY --from=builder --chown=app:app /app/packages/env /app/packages/env
COPY --from=builder --chown=app:app /app/examples/full-stack/shared/env-contracts /app/examples/full-stack/shared/env-contracts
HEALTHCHECK --interval=15s --timeout=3s --retries=3 CMD ["wget","--spider","-q","http://localhost:8080/healthz"]
USER app
CMD ["bun","run","src/main.ts"]
