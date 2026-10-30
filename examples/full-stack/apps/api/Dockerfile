# konfig-managed: @konfig.ts/docker
# spec: examples/full-stack/apps/api/docker.ts
# hash: sha256:2f7d1f99e6cb21d3b29f5398da5aca7a80ece2d3b7d08e83363614b4c6271a0f
FROM oven/bun:1.3.5-alpine AS base

FROM base AS deps
WORKDIR /app
COPY package.json bun.lock ./
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
COPY apps/website/package.json ./apps/website/
RUN bun install --frozen-lockfile --ignore-scripts
RUN mkdir -p packages/core/node_modules packages/env/node_modules examples/full-stack/shared/env-contracts/node_modules packages/docker/node_modules examples/full-stack/apps/api/node_modules

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules /app/node_modules
COPY --from=deps /app/packages/core/node_modules /app/packages/core/node_modules
COPY --from=deps /app/packages/env/node_modules /app/packages/env/node_modules
COPY --from=deps /app/examples/full-stack/shared/env-contracts/node_modules /app/examples/full-stack/shared/env-contracts/node_modules
COPY --from=deps /app/packages/docker/node_modules /app/packages/docker/node_modules
COPY --from=deps /app/examples/full-stack/apps/api/node_modules /app/examples/full-stack/apps/api/node_modules
COPY packages/core ./packages/core
COPY packages/env ./packages/env
COPY examples/full-stack/shared/env-contracts ./examples/full-stack/shared/env-contracts
COPY packages/docker ./packages/docker
COPY examples/full-stack/apps/api ./examples/full-stack/apps/api
WORKDIR /app/examples/full-stack/apps/api

FROM base AS prod-deps
WORKDIR /app
COPY package.json bun.lock ./
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
COPY apps/website/package.json ./apps/website/
RUN bun install --ignore-scripts --frozen-lockfile --production --filter @example/api
RUN mkdir -p packages/core/node_modules packages/env/node_modules examples/full-stack/shared/env-contracts/node_modules examples/full-stack/apps/api/node_modules

FROM builder AS sources
WORKDIR /app
RUN rm -rf /app/packages/core/node_modules /app/packages/env/node_modules /app/examples/full-stack/shared/env-contracts/node_modules /app/examples/full-stack/apps/api/node_modules

FROM base AS runner
WORKDIR /app/examples/full-stack/apps/api
RUN addgroup -S -g 1001 app && adduser -S -u 1001 -G app app
ENV LOG_LEVEL=info NODE_ENV=production
EXPOSE 8080
COPY --from=prod-deps --chown=app:app /app/node_modules /app/node_modules
COPY --from=sources --chown=app:app /app/packages/core /app/packages/core
COPY --from=sources --chown=app:app /app/packages/env /app/packages/env
COPY --from=sources --chown=app:app /app/examples/full-stack/shared/env-contracts /app/examples/full-stack/shared/env-contracts
COPY --from=sources --chown=app:app /app/examples/full-stack/apps/api /app/examples/full-stack/apps/api
COPY --from=prod-deps --chown=app:app /app/packages/core/node_modules /app/packages/core/node_modules
COPY --from=prod-deps --chown=app:app /app/packages/env/node_modules /app/packages/env/node_modules
COPY --from=prod-deps --chown=app:app /app/examples/full-stack/shared/env-contracts/node_modules /app/examples/full-stack/shared/env-contracts/node_modules
COPY --from=prod-deps --chown=app:app /app/examples/full-stack/apps/api/node_modules /app/examples/full-stack/apps/api/node_modules
HEALTHCHECK --interval=15s --timeout=3s --retries=3 CMD ["wget","--spider","-q","http://localhost:8080/healthz"]
USER app
CMD ["bun","run","src/main.ts"]
