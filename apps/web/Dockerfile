FROM node:22-bookworm-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/package.json
RUN npm ci --ignore-scripts

COPY apps/web ./apps/web

# NEXT_PUBLIC values are compiled into the browser bundle by next build.
ARG NEXT_PUBLIC_API_BASE_URL
RUN node -e 'const value = process.env.NEXT_PUBLIC_API_BASE_URL; if (!value) throw new Error("NEXT_PUBLIC_API_BASE_URL is required at build time"); const url = new URL(value); if (url.origin !== value || (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)))) throw new Error("NEXT_PUBLIC_API_BASE_URL must be an HTTPS origin without a trailing slash (localhost HTTP is allowed for local testing)");'
RUN npm run build:web

FROM node:22-bookworm-slim AS runner

ENV NODE_ENV=production
ENV PORT=8080
WORKDIR /app

COPY --from=builder --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/apps/web ./apps/web

USER node
EXPOSE 8080

CMD ["sh", "-c", "exec node node_modules/next/dist/bin/next start apps/web --hostname 0.0.0.0 --port \"${PORT:-8080}\""]
