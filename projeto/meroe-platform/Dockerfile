# ============================================================
# MEROE Platform — Dockerfile
# ============================================================
FROM node:20-alpine AS base
RUN apk add --no-cache dumb-init
WORKDIR /app
ENV NODE_ENV=production

FROM base AS deps
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM base AS final
COPY --from=deps /app/node_modules ./node_modules
COPY src/ ./src/
COPY sql/ ./sql/
RUN mkdir -p logs && chown -R node:node /app
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "const p = process.env.PORT || 4000; require('http').get('http://127.0.0.1:' + p + '/api/health', r => r.statusCode === 200 ? process.exit(0) : process.exit(1)).on('error', () => process.exit(1))"
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "src/server.js"]
