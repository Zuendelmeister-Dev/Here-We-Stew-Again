FROM node:24-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATA_DIR=/app/data

RUN mkdir -p /app/data && chown node:node /app/data
COPY --chown=node:node package.json server.mjs recovery.mjs ./
COPY --chown=node:node lib ./lib
COPY --chown=node:node public ./public

USER node
EXPOSE 3000
VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:' + process.env.PORT + '/api/health', { signal: AbortSignal.timeout(3000) }).then(response => { if (!response.ok) process.exitCode = 1 }).catch(() => { process.exitCode = 1 })"]

CMD ["node", "server.mjs"]
