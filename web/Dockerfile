# syntax=docker/dockerfile:1

# Build context is the repository ROOT; this app lives in web/.
# In the deploy platform, set the Dockerfile path to web/Dockerfile and leave
# the build context at the repository root.

# --- deps: install from the lockfile (manifests only, cache-friendly) ---
FROM node:22-alpine AS deps
WORKDIR /app
COPY web/package.json web/package-lock.json ./
RUN npm ci

# --- build: compile to Next.js standalone output ---
FROM node:22-alpine AS build
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY web/ ./
RUN npm run build

# --- runtime: minimal image running the standalone server ---
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3002
ENV HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
USER node
EXPOSE 3002
CMD ["node", "server.js"]
