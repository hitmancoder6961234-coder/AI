# syntax=docker/dockerfile:1.7
# Darkness AI — production image. Multi-stage, non-root, no build tooling in the final layer.

FROM node:22-slim AS build
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    NPM_CONFIG_UPDATE_NOTIFIER=false
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-slim AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    CLARITY_STORAGE_ROOT=/data \
    PRIVACY_STRICT=true
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/public ./public
RUN mkdir -p /data /app/public/uploads && chown -R node:node /data /app/public/uploads
USER node
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]
