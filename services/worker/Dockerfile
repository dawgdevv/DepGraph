# DepGraph Worker — VPS deployment
FROM oven/bun:1 AS base
WORKDIR /app

# Install deps for cloning + scanning
RUN apt-get update && apt-get install -y git ca-certificates && rm -rf /var/lib/apt/lists/*

# Copy workspace (needs root worker/ + services/worker)
COPY package.json ./
COPY worker ./worker
COPY services/worker ./services/worker
# lib needed only for github helper fallback — copy minimal
COPY lib ./lib
COPY tsconfig.json ./

WORKDIR /app/services/worker
RUN bun install --frozen-lockfile 2>/dev/null || bun install

# Env defaults (override at runtime)
ENV PORT=3001
ENV NODE_ENV=production

EXPOSE 3001

# Persist analyses between restarts (mount a volume at /data)
VOLUME ["/data"]
ENV WORKER_STORE_PATH=/data/analyses.json

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["bun", "run", "src/server.ts"]
