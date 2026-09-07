# syntax=docker/dockerfile:1
#
# Multi-stage build for @forjd/api (Cloud Run staging/production, ADR-015).
# `pnpm fetch` populates the store from pnpm-lock.yaml and pnpm-workspace.yaml alone (no
# package.json needed yet), so this layer caches even when app source changes. Both files are
# copied -- not just the lockfile -- because pnpm-workspace.yaml carries the `allowBuilds`
# approvals (esbuild, for drizzle-kit's postinstall) that `pnpm fetch` needs; without it pnpm
# 11 refuses to fetch at all (ERR_PNPM_IGNORED_BUILDS) instead of silently skipping the
# scripts. The final image ships only @forjd/api's production dependency tree via
# `pnpm deploy --prod`, not the whole monorepo workspace (apps/mobile's React Native deps
# never reach the runtime image).

FROM node:22-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

FROM base AS fetch
WORKDIR /workspace
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch

FROM fetch AS build
WORKDIR /workspace
COPY . .
RUN pnpm install --offline --frozen-lockfile
RUN pnpm --filter @forjd/api... run build
# pnpm v10+ defaults to requiring "inject-workspace-packages=true" for `deploy`; --legacy
# opts back into the older (still fully supported) resolve-and-copy behavior instead of
# adding that setting workspace-wide just for this one Docker stage.
RUN pnpm --filter @forjd/api deploy --prod --legacy /workspace/deploy

FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /workspace/deploy/package.json ./package.json
COPY --from=build /workspace/deploy/dist ./dist
COPY --from=build /workspace/deploy/node_modules ./node_modules

# Cloud Run injects PORT and expects the process to bind it on all interfaces;
# main.ts's app.listen(port) does this with no host argument (Node's default).
EXPOSE 8080
CMD ["node", "dist/main.js"]
