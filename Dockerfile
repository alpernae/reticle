# Reticle — production image.
# Node 24 LTS: node:sqlite (the app's database driver) is built in, no native deps.
# Multi-stage: deps → build (standalone output) → slim runtime with the Claude CLI.

FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:24-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 NEXT_OUTPUT=standalone
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 HOSTNAME=0.0.0.0 \
    DATA_DIR=/data
# Claude Code CLI = the "Claude CLI (subscription)" AI provider. It authenticates with the
# long-lived token you save on Settings (from `claude setup-token`) — no login inside the container.
# Set INSTALL_CLAUDE_CLI=false to skip it (then use the Claude API key provider instead).
ARG INSTALL_CLAUDE_CLI=true
RUN if [ "$INSTALL_CLAUDE_CLI" = "true" ]; then \
      npm install -g --no-audit --no-fund --allow-scripts=@anthropic-ai/claude-code @anthropic-ai/claude-code \
      && npm cache clean --force; \
    fi
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
