# syntax=docker/dockerfile:1

# --- deps: install the full dependency set from the lockfile (cache-friendly) ---
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# --- build: compile the API, then prune dev dependencies for the runtime image ---
FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build && npm prune --omit=dev

# --- runtime: minimal image with the compiled API, prod deps, and migrations ---
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/drizzle ./drizzle
COPY --from=build --chown=node:node /app/package.json ./package.json
USER node
EXPOSE 3000
# Apply migrations with the drizzle-orm runtime migrator, then start the API.
CMD ["sh", "-c", "node dist/migrate.js && node dist/main.js"]
