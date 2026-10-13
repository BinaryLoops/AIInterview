# Local development infrastructure

Run these commands from the repository root. Docker Compose files live in `infra/docker/`.

## Prerequisites

- Docker Engine or Docker Desktop with Compose v2
- A local `.env` file created from `.env.example`

```bash
cp .env.example .env
```

On Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

`.env` is gitignored. Do not commit credentials.

## Start

```bash
pnpm infra:up
```

Equivalent:

```bash
docker compose --env-file .env -f infra/docker/compose.yaml up -d --wait
```

`--wait` blocks until health checks pass.

## Inspect

```bash
pnpm infra:ps
pnpm infra:logs
```

From the host (published on localhost only):

| Service | Host address | In-compose hostname |
| --- | --- | --- |
| PostgreSQL | `127.0.0.1:5432` | `postgres` |
| Redis | `127.0.0.1:6379` | `redis` |
| Mailpit SMTP | `127.0.0.1:1025` | `mailpit:1025` |
| Mailpit UI | [http://127.0.0.1:8025](http://127.0.0.1:8025) | `mailpit:8025` |

## Stop

Keep volumes (database and Redis data):

```bash
pnpm infra:down
```

Remove volumes as well:

```bash
docker compose --env-file .env -f infra/docker/compose.yaml down -v
```

## Validate Compose without starting

```bash
pnpm infra:config
```

## Operations & Deployment Runbook

For complete operational procedures, staging integration checklists, production environment templates, non-destructive validation (`pnpm auth:validate-config`), health checks, and troubleshooting, refer to:
- [`docs/member-1-auth-handoff.md`](member-1-auth-handoff.md)
- [`docs/auth-staging-handoff.md`](auth-staging-handoff.md)
- [`docs/auth-service-operations.md`](auth-service-operations.md)
- [`.env.production.example`](../.env.production.example)

> **Important Safety Note on PostgreSQL Testing:**
> Automated test suites in `services/auth-service` run in-memory by default. When running real PostgreSQL integration tests (`pnpm test:postgres`), ensure the target database runs on a dedicated port (e.g. 5433) and **never targets host port 5432**.

