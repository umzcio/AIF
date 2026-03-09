### Stage 1: Build frontend
FROM node:22-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install
COPY frontend/ ./
RUN npm run build

### Stage 2: Runtime
FROM node:22-bookworm-slim

# System deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    git curl ca-certificates python3 unzip pandoc && \
    rm -rf /var/lib/apt/lists/*

# CLI tools for agent pipeline
RUN npm install -g @openai/codex @google/gemini-cli @anthropic-ai/claude-code @qwen-code/qwen-code

# Codex auth dir (auth.json written at startup with OPENAI_API_KEY from env)
RUN mkdir -p /home/aif/.codex

# Configure QwenCode to use OpenRouter
RUN mkdir -p /home/aif/.qwen && echo '{\
  "modelProviders": {\
    "openai": [{\
      "id": "qwen/qwen3-coder",\
      "name": "Qwen3 Coder",\
      "baseUrl": "https://openrouter.ai/api/v1",\
      "envKey": "OPENROUTER_API_KEY"\
    }]\
  },\
  "security": { "auth": { "selectedType": "openai" } },\
  "model": { "name": "qwen/qwen3-coder" }\
}' > /home/aif/.qwen/settings.json

# opencode (Go binary) — copy from host if available, otherwise download
COPY opencode /usr/local/bin/opencode

WORKDIR /app

# Backend deps
COPY backend/package.json backend/package-lock.json* ./backend/
RUN cd backend && npm install --omit=dev

# Backend source
COPY backend/ ./backend/

# HECVAT template
COPY hecvat415.xlsx ./hecvat415.xlsx

# Migrations
COPY backend/migrations/ ./backend/migrations/

# Frontend build output
COPY --from=frontend-build /app/frontend/dist ./frontend/dist

# Data directories
RUN mkdir -p /data/output /data/codebases

# Non-root user for runtime security
RUN groupadd -r aif && useradd -r -g aif -d /home/aif -m -s /sbin/nologin aif && \
    chown -R aif:aif /app /data /home/aif

# Startup script — runs as root initially to fix volume ownership, then drops to aif
COPY <<'STARTUP' /app/startup.sh
#!/bin/sh
set -e
# Fix ownership on mounted volumes (they may be root-owned from prior runs)
chown -R aif:aif /data /home/aif 2>/dev/null || true
# Write codex auth safely via node (avoids shell injection with special chars in API key)
su -s /bin/sh aif -c "node -e \"const fs=require('fs'); fs.writeFileSync('/home/aif/.codex/auth.json', JSON.stringify({auth_mode:'apikey',OPENAI_API_KEY:process.env.OPENAI_API_KEY||''}))\""
cd /app/backend
su -s /bin/sh aif -c "node src/db/migrate.js"
exec su -s /bin/sh aif -c "node src/server.js"
STARTUP
RUN chmod +x /app/startup.sh

ENV NODE_ENV=production
ENV PORT=3000
ENV BASE_PATH=/aif
ENV OUTPUT_DIR=/data/output
ENV CODEBASES_DIR=/data/codebases
ENV HECVAT_TEMPLATE_PATH=/app/hecvat415.xlsx

EXPOSE 3000

# Start as root so startup.sh can fix volume ownership, then drops to aif
CMD ["/app/startup.sh"]
