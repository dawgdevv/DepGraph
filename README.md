# DepGraph
### See exactly what depends on a vulnerable package.

DepGraph takes a public GitHub URL, resolves the real npm tree, scans it with CVE-Lite, and shows — in a graph — how each vulnerability reaches your app.

> **Why does this vulnerability affect this repository?** Not just *which* package is vulnerable, but which direct deps pull it in and how many paths are affected.

---

## 🎬 Demo

> **2-minute walkthrough — blast radius in one click**

<p align="center">
  <a href="https://drive.google.com/file/d/19fZYDzhTIHg4bkuIBXnH8DTXu10gkXE2/view?usp=sharing" target="_blank">
    <img src="https://via.placeholder.com/800x450?text=►+Click+to+Watch+Demo+-+2+min" alt="DepGraph demo — whole flow" width="800"/>
  </a>
  <br/>
  <em>Whole flow: paste URL → analyze → blast radius → paths → files (2 min)</em>
  <br/>
  <a href="https://drive.google.com/file/d/19fZYDzhTIHg4bkuIBXnH8DTXu10gkXE2/view?usp=sharing">Open in Drive</a> · make sure sharing is <code>Anyone with link → Viewer</code>
</p>

```
Repository → Parse lockfile → CVE-Lite → CognoDB → Blast radius → Graph
```

---

## What is this?

Traditional scanners say:

```
follow-redirects@1.15.9 is vulnerable
```

DepGraph says:

```
my-app → api-client → axios → follow-redirects [CVE-2025-0999, HIGH]
       → 3 dependent packages, 2 paths (1 direct, 1 transitive)
       → src/lib/api.ts imports axios → reachable
```

**Not a scanner replacement.** CVE-Lite finds it, DepGraph explains impact. No auto-fix, no `npm install`, no PRs — just clarity.

---

## How it works (brief)

1. **Load** — `git clone --depth 1` public repo to temp (60s timeout)
2. **Validate** — `package.json` must exist; `package-lock.json` is generated via `npm install --package-lock-only` if missing, otherwise direct-deps fallback
3. **Parse** — lockfile `packages` map → `PackageRecord` (`name@version`, `isDirect`, edges)
4. **Scan** — `npx cve-lite-cli <dir> --json --all` → file `cve-lite-scan-*.json` → normalized `VulnerabilityFinding[]` (handles stdout file output, not just stdout)
5. **File reachability** — TypeScript ESTree (`ts.createSourceFile`) + regex fallback scans `**/*.{ts,tsx,js,jsx}` for `import`/`require`/`import()` → `FileImport[]`
6. **Graph** — write to **CognoDB** (see below), compute `affectedPaths`, poll via Next.js
7. **Explore** — interact, highlight blast radius, search packages/files/CVE, expand modules

The good part — how paths are traversed, grouped, and highlighted at scale — is in the video.

---

## How CognoDB is used

We don't just store JSON. We model relationships:

```
(:Project {id})-[:DEPENDS_ON]->(:Package {name, version, isDirect})
(:Package)-[:DEPENDS_ON]->(:Package)
(:Package)-[:HAS_VULNERABILITY]->(:Vulnerability {severity, identifier})
(:Project)-[:CONTAINS]->(:File)-[:IMPORTS]->(:Package)
```

- Scoped by `analysisId` (`id: ${analysisId}:${name}@${version}`) — concurrent analyses don't collide, re-run is idempotent (`MATCH {analysisId} DETACH DELETE` first)
- **Blast radius** is a reverse traversal: `MATCH path=(proj)-[:DEPENDS_ON*]->(pkg)-[:HAS_VULNERABILITY]->(v)` → counts `dependentPackages`, `paths`, `direct vs transitive`, and `pathNodeIds` for highlighting. No tables, just traversals.

Credentials (`COGNODB_URI` etc.) stay server-only, queries are parameterized.

> Want the Cypher? Watch the video — or see `worker/graph/write-graph.ts` and `lib/cognodb/queries.ts`.

---

## Stack

Next.js 16 · React 19 · TypeScript · Tailwind · Bun worker · **CognoDB (Neo4j driver)** · CVE-Lite CLI · TypeScript ESTree

---

## Quick start (local)

**Worker** (does the heavy work, separate process):

```bash
# services/worker/.env  (see .env.example)
PORT=3001
WORKER_TOKEN=local-secret
CORS_ORIGIN=http://localhost:3000
WORKER_STORE_PATH=./data/analyses.json
COGNODB_URI=bolt+s://...
COGNODB_USERNAME=...
COGNODB_PASSWORD=...

cd services/worker
bun install
bun run src/server.ts
# → http://localhost:3001/health
```

**Web** (proxies to worker when `WORKER_URL` set):

```bash
# .env.local (root)
WORKER_URL=http://localhost:3001
WORKER_TOKEN=local-secret
COGNODB_URI=bolt+s://...
COGNODB_USERNAME=...
COGNODB_PASSWORD=...

npm install
npm run dev
# → http://localhost:3000  paste https://github.com/dawgdevv/greplica
```

Without `WORKER_URL`, Next runs the worker in-process (dev fallback).

---

## Worker on VPS (Vercel + VPS)

Vercel runs the Next app, VPS runs the Bun worker. `app/api/analyses` proxies to `WORKER_URL` with `Authorization: Bearer <token>` when set.

```bash
docker compose up -d   # uses services/worker/Dockerfile, volume /data
# or bare metal: see services/worker/README.md (systemd example)
```

---

## Env

| Where | Key | Purpose |
|-------|-----|---------|
| Worker & Web | `COGNODB_URI` `COGNODB_USERNAME` `COGNODB_PASSWORD` | CognoDB — server only |
| Worker | `PORT` `WORKER_TOKEN` `CORS_ORIGIN` `WORKER_STORE_PATH` | VPS service |
| Web | `WORKER_URL` `WORKER_TOKEN` | Proxy to VPS (`http://localhost:3001` local) |

---

## Routes

- `/` — paste GitHub URL
- `/analysis/[id]` — poll `GET /api/analyses/[id]`, then `GET /api/graph/[id]` → interactive graph (modules/file-groups, search highlights blast path, expand to inspect)

---

*Detailed architecture, Cypher, and large-repo grouping (modules/file-groups, ESTree vs regex, center-fit) — in the video.*

