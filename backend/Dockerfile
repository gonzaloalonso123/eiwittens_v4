# ── Build stage ─────────────────────────────────────────────────────────────
FROM node:20-slim AS builder

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy workspace config and lockfile
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages/types/package.json ./packages/types/
COPY backend/package.json backend/tsconfig.json ./backend/

RUN pnpm install --frozen-lockfile

# Copy source
COPY packages/types/ ./packages/types/
COPY backend/src/ ./backend/src/

# Build types first, then backend
RUN pnpm --filter @eiwittens/types build && \
    echo "=== Types dist ===" && ls -la packages/types/dist/ && \
    echo "=== Symlink ===" && ls -la backend/node_modules/@eiwittens/ 2>/dev/null || true && \
    echo "=== Root symlink ===" && ls -la node_modules/@eiwittens/ 2>/dev/null || true
RUN cd backend && pnpm exec tsc

# ── Runtime stage ────────────────────────────────────────────────────────────
FROM node:20-slim

RUN corepack enable && corepack prepare pnpm@latest --activate

# Install Chromium and its OS-level dependencies (works on both amd64 and arm64)
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    libnss3 \
    libatk-bridge2.0-0 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    && rm -rf /var/lib/apt/lists/*

# Tell Playwright not to try to download its own browser — use the system one
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

WORKDIR /app

# Copy workspace config for pnpm to resolve workspace deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/types/package.json ./packages/types/
COPY backend/package.json ./backend/

RUN pnpm install --frozen-lockfile --prod

# Copy built output
COPY --from=builder /app/packages/types/dist ./packages/types/dist
COPY --from=builder /app/backend/dist ./backend/dist

EXPOSE 8080

CMD ["node", "backend/dist/main.js"]
