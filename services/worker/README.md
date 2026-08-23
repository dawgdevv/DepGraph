# DepGraph Worker Service (VPS)

Bun HTTP service that does the heavy lifting (git clone → validate → parse → CVE-Lite scan → graph build).  
Next.js on Vercel proxies `/api/analyses` to this when `WORKER_URL` is set.

## Deploy on VPS

### 1. Env

```bash
cp .env.example .env
# edit:
# PORT=3001
# WORKER_TOKEN=long-random-secret   # same value as Vercel env WORKER_TOKEN
# CORS_ORIGIN=https://your-app.vercel.app
# COGNODB_URI=bolt+s://...
# COGNODB_USERNAME=...
# COGNODB_PASSWORD=...
# WORKER_STORE_PATH=/data/analyses.json
```

### 2. Bare-metal (Bun)

```bash
bun install
WORKER_TOKEN=secret PORT=3001 bun run src/server.ts
# health
curl http://127.0.0.1:3001/health
```

Systemd (`/etc/systemd/system/depgraph-worker.service`):

```ini
[Unit]
Description=DepGraph Worker
After=network.target

[Service]
User=depgraph
WorkingDirectory=/opt/depgraph/services/worker
EnvironmentFile=/opt/depgraph/services/worker/.env
ExecStart=/home/depgraph/.bun/bin/bun run src/server.ts
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

### 3. Docker

```bash
docker build -t depgraph-worker -f services/worker/Dockerfile .
docker run -d --name depgraph-worker \
  --env-file services/worker/.env \
  -p 3001:3001 \
  -v depgraph-data:/data \
  --restart unless-stopped \
  depgraph-worker
```

Docker Compose (root `docker-compose.yml`):

```yaml
services:
  worker:
    build:
      context: .
      dockerfile: services/worker/Dockerfile
    env_file: services/worker/.env
    ports: ["3001:3001"]
    volumes: [worker-data:/data]
    restart: unless-stopped
volumes:
  worker-data:
```

Behind Caddy/Nginx reverse proxy — forward `/` to `127.0.0.1:3001`, add TLS.

## API

| Method | Path | Auth | Body | Notes |
|---|---|---|---|---|
| GET | `/health` | no | — | liveness |
| POST | `/analyses` | Bearer `WORKER_TOKEN` (if set) | `{ repositoryUrl }` | creates + fire-and-forget runAnalysis |
| GET | `/analyses/:id` | Bearer | — | poll status |
| GET | `/analyses` | Bearer | — | list (debug) |
| DELETE | `/analyses/:id` | Bearer | — | remove |

Vercel sets:

```
WORKER_URL=https://worker.yourdomain.com
WORKER_TOKEN=same-as-vps
```

If `WORKER_URL` unset, Next.js falls back to in-process `worker/index.ts` (local dev).

## Security

- Set `WORKER_TOKEN` — service rejects without `Authorization: Bearer <token>`.
- Set `CORS_ORIGIN` to your Vercel origin (not `*`) in production.
- Never expose `COGNODB_*` to client — service reads them server-only.
