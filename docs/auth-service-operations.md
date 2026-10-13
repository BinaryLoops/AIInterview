# Auth-Service Operations Runbook & Deployment Guide

This document details the configuration, deployment, diagnostics, and operational procedures for the AREP `auth-service`. It is targeted at operators, engineers, and platform administrators preparing for staging and production deployments.
For staging handoff checklists, explicit acceptance gates, and step-by-step smoke testing, see [`docs/auth-staging-handoff.md`](auth-staging-handoff.md).

---

## 1. Environment Configuration Matrix

The `auth-service` uses strict configuration parsing via `parseAuthConfig()`. Below is the variable specification across environments:

| Variable | Development Default | Testing (`NODE_ENV=test`) | Staging / Production | Purpose & Validation Rules |
| :--- | :--- | :--- | :--- | :--- |
| `NODE_ENV` | `development` | `test` | `production` | Runtime mode. Must be one of `development`, `test`, `production`. |
| `HOST` | `127.0.0.1` | `127.0.0.1` | `0.0.0.0` | Listen host. Must not contain whitespace. Use `0.0.0.0` in containers. |
| `PORT` | `3001` | `3001` | `3001` | Listen port. Integer between 1 and 65535. |
| `APP_BASE_URL` | `http://127.0.0.1:3001` | `http://127.0.0.1:3001` | `https://auth.example.com` | Canonical service URL. **MUST use `https://` in production.** |
| `TRUST_PROXY` | `false` | `false` | `true` (behind ingress) | Strict boolean (`true`/`false`). When `true`, trusts upstream reverse proxy `X-Forwarded-For`. |
| `CORS_ALLOWED_ORIGINS` | Defaults to localhost/dev | Defaults to test URL | **Required** (HTTPS only) | Comma-separated list of browser origins. Wildcards (`*`) and `localhost` are forbidden in production. |
| `DATABASE_ENABLED` | `false` (in-memory) | `false` (or test db) | **Required: `true`** | Ephemeral in-memory database is forbidden in production. |
| `DATABASE_URL` | Optional in dev | Optional / dedicated port | **Required** (PostgreSQL URL) | Connection string. Cannot contain dev placeholder passwords (`arep_dev_only`). |
| `REDIS_ENABLED` | `false` (in-memory) | `false` (or test redis) | **Required: `true`** | Distributed token revocation & rate limiting. Forbidden to disable in production. |
| `REDIS_HOST` | `127.0.0.1` | `127.0.0.1` | **Required** (host) | Redis hostname or IP. |
| `REDIS_PORT` | `6379` | `6379` | `6379` | Redis TCP port (1-65535). |
| `REDIS_PASSWORD` | Optional in dev | Optional in test | **Required** (strong secret) | Password. Cannot contain placeholder (`arep_redis_dev_only`). |
| `OTP_HMAC_SECRET` | Dev placeholder | Dev placeholder | **Required** (>= 32 chars) | Cryptographic HMAC secret for OTP hashes. Rejects dev defaults and dictionary words. |
| `OTP_TTL_SECONDS` | `600` (10m) | `600` | `600` | Expiration window for OTP challenges. |
| `OTP_MAX_ATTEMPTS` | `5` | `5` | `5` | Max incorrect attempts before challenge is locked out. |
| `JWT_SECRET` | Dev placeholder | Dev placeholder | **Required** (>= 32 chars) | HMAC-SHA256 secret for access tokens. Rejects dev defaults and dictionary words. |
| `JWT_EXPIRES_IN_SECONDS` | `900` (15m) | `900` | `900` | Access token lifespan. Integer (default 15 minutes). |
| `JWT_ISSUER` | `arep-auth-service` | `arep-auth-service` | `arep-auth-service` | Token issuer (`iss` claim). |
| `JWT_AUDIENCE` | `arep-api` | `arep-api` | `arep-api` | Token audience (`aud` claim). |
| `SESSION_REFRESH_TOKEN_TTL_DAYS` | `7` | `7` | `7` | Refresh token lifespan in database and cookie. |
| `SMTP_ENABLED` | `false` | `false` | Optional (`true`/`false`) | If enabled, SMTP host/port/auth are validated. |
| `SMTP_AUTH_REQUIRED` | `false` | `false` | `true` (if enabled) | Requires username and password when true. |

---

## 2. Non-Destructive Pre-Flight Configuration Validation

Before starting or deploying `auth-service`, run the non-destructive configuration validation command. This validates all variables and rejects weak or missing secrets **without connecting to PostgreSQL, Redis, SMTP, or any external service**:

```bash
# From workspace root
pnpm auth:validate-config

# Or directly in services/auth-service
pnpm --filter auth-service config:validate
```

### Validation Outcomes
- **Success (Exit code 0):** Prints a redacted configuration summary confirming parameter readiness without exposing secrets or connection strings.
- **Failure (Exit code 1):** Prints an itemized list of all detected configuration issues (e.g. weak secret, missing database URL, unencrypted HTTP URL in production).

---

## 3. Starting the Service & Health Verification

### Starting Locally (Development)
```bash
# Starts TypeScript watcher and launches auth-service on http://127.0.0.1:3001
pnpm --filter auth-service dev
```

### Starting in Production / Staging
```bash
# 1. Compile TypeScript bundle
pnpm --filter auth-service build

# 2. Start NestJS production entrypoint
pnpm --filter auth-service start
```

### Verifying Liveness (`/health`)
Checks if the process is alive and able to handle HTTP events. Does not assert external dependencies to avoid crashlooping during transient dependency hiccups:
```bash
curl -i http://localhost:3001/health
```
**Expected Response (HTTP 200 OK):**
```json
{
  "status": "ok",
  "service": "auth-service"
}
```

### Verifying Readiness (`/ready`)
Checks if required external dependencies (`database`, `redis`) under the active configuration are responsive.
```bash
curl -i http://localhost:3001/ready
```
**Expected Response when Healthy (HTTP 200 OK):**
```json
{
  "status": "ready",
  "service": "auth-service",
  "checks": {
    "process": "up",
    "database": "up",
    "redis": "up"
  }
}
```
**Expected Response when Degraded (HTTP 503 Service Unavailable):**
```json
{
  "status": "not_ready",
  "service": "auth-service",
  "checks": {
    "process": "up",
    "database": "down",
    "redis": "up"
  }
}
```
*Note: Connection strings, error messages, and credentials are never included in the health/readiness response.*

---

## 4. Applying Prisma Migrations Safely

### CRITICAL SAFETY RULES
1. **NEVER apply migrations against host port 5432.** Port 5432 is reserved for unrelated host system services.
2. Ensure you are targeting a dedicated database instance (e.g. port 5433 or an isolated staging RDS instance).
3. Set the target database URL via `DATABASE_URL` explicitly for the migration command.

### Deployment / CI Migration Command
To apply pending migrations without resetting data:
```bash
DATABASE_URL="postgresql://user:pass@staging-db.internal:5432/arep_staging" \
pnpm --filter auth-service prisma migrate deploy
```

### Checking Migration Status
```bash
DATABASE_URL="postgresql://user:pass@staging-db.internal:5432/arep_staging" \
pnpm --filter auth-service prisma migrate status
```

### Local Development Migration Creation
When modifying `services/auth-service/prisma/schema.prisma` in development:
```bash
DATABASE_URL="postgresql://arep:password@127.0.0.1:5433/arep_dev" \
pnpm --filter auth-service prisma migrate dev --name <descriptive_name>
```

---

## 5. Security Architecture & Component Configuration

### A. CORS & CSRF Defense
- **Browser Origin Matching:** In production, `CORS_ALLOWED_ORIGINS` must contain exact HTTPS origins (e.g. `https://app.arep.ai,https://admin.arep.ai`).
- **Credentials:** Because browser refresh tokens use cookies (`credentials: true`), CORS wildcards (`*`) are disallowed by the browser specification and rejected by startup validation.
- **CSRF Defense:** Cookie-authenticated endpoints (`/auth/refresh` and `/auth/logout`) inspect the incoming `Origin` and `Referer` headers against `isAllowedOrigin()`. Untrusted origins receive HTTP 403 Forbidden.

### B. Cookie Security Attributes
The refresh token cookie is set and cleared with identical secure attributes:
- `HttpOnly: true` (JavaScript cannot read or extract the token, mitigating XSS).
- `Secure: true` (enforced when `NODE_ENV=production` or `APP_BASE_URL` uses HTTPS).
- `SameSite: Lax` (prevents cross-site request forgery while permitting top-level navigation).
- `Path: /auth` (cookie is only sent to `/auth/refresh` and `/auth/logout`).
- `Max-Age: SESSION_REFRESH_TOKEN_TTL_DAYS * 86400 * 1000`.

### C. Trusted Proxies & Client IP Inspection
- When `TRUST_PROXY=true`, the service inspects `X-Forwarded-For` for rate limiting and audit logs.
- **Security Prerequisite:** The upstream reverse proxy (Cloudflare, AWS ALB, NGINX) **must** be configured to overwrite or strip incoming client `X-Forwarded-For` headers to prevent IP spoofing attacks.

### D. Cryptographic Secrets Generation
Generate production secrets using cryptographically secure random sources:
```bash
# Generate OTP_HMAC_SECRET
openssl rand -hex 32

# Generate JWT_SECRET
openssl rand -hex 32
```
Secrets shorter than 32 characters or containing substrings like `placeholder`, `changeme`, or `dev_` will fail startup validation.

### E. Distributed Redis Revocation & Fail-Closed Policy
- All token revocations (user suspension, password reset, logout, compromise containment) write an epoch timestamp to Redis under `auth:revocation:user:<userId>` and `auth:revocation:session:<sessionId>`.
- **Fail-Closed Guarantee:** If Redis is enabled but becomes unreachable during token revocation lookup, `TokenService.isTokenRevoked()` immediately fails closed by throwing `ServiceUnavailableException` (HTTP 503 Service Unavailable) rather than assuming tokens are valid or incorrectly claiming credentials are 401 Unauthorized. This prevents unauthorized access bypass while signaling infrastructure unavailability to upstream gateways and clients.

---

## 6. Diagnostics & Troubleshooting Runbook

### Issue 1: Service Fails to Start with `ConfigValidationError`
- **Symptom:** Process exits immediately with code 1: `Invalid configuration: ...`.
- **Root Cause:** A required environment variable is missing, malformed, or using a development default in production.
- **Diagnosis:** Run `pnpm auth:validate-config` to inspect the error list. Do NOT log raw environment variables. Verify that:
  - `DATABASE_ENABLED=true` and `REDIS_ENABLED=true` in production.
  - `APP_BASE_URL` and `CORS_ALLOWED_ORIGINS` start with `https://`.
  - Secrets are >= 32 characters and do not contain placeholder phrases.

### Issue 2: Readiness Endpoint (`/ready`) Returns HTTP 503
- **Symptom:** Orchestrator (Kubernetes/ECS) does not route traffic to the pod. `/ready` returns HTTP 503.
- **Diagnosis:** Examine response body:
  - If `checks.database === 'down'`: Test database connectivity from the container network using `pg_isready`. Check DB connection limit, firewall rules, and TLS configuration.
  - If `checks.redis === 'down'`: Check Redis server status and network latency. Check Redis authentication credentials.

### Issue 3: Refresh or Logout Returns HTTP 403 `CSRF check failed`
- **Symptom:** Browser client receives 403 Forbidden on `/auth/refresh` or `/auth/logout`.
- **Diagnosis:** The client's `Origin` or `Referer` header does not match any entry in `CORS_ALLOWED_ORIGINS`. Verify that the frontend domain (including protocol and port if non-standard) is present in `CORS_ALLOWED_ORIGINS`.

### Issue 4: Email Delivery Failure (`EmailDeliveryError`)
- **Symptom:** OTP emails fail to dispatch; service logs `[EmailService] Failed to send email`.
- **Diagnosis:**
  - Verify SMTP host and port: Port 465 uses implicit TLS (`SMTP_SECURE=true`); Port 587 uses STARTTLS (`SMTP_SECURE=false`).
  - Verify SMTP credentials and sender identity (`SMTP_FROM`). Ensure the domain is authorized in Amazon SES / SendGrid / Mailgun.
  - Sensitive details (passwords, OTP codes) are omitted from error logs by design.

### Issue 5: Protected Route Requests Fail with HTTP 503 or HTTP 401
- **Symptom A (HTTP 503 Service Unavailable):** Valid access token is rejected on protected routes with message `Authentication revocation registry is unavailable. Protected requests cannot be verified.`.
  - **Diagnosis:** Redis is unreachable or its connection pool is exhausted. When Redis fails, `TokenService.isTokenRevoked()` intentionally fails closed by throwing `ServiceUnavailableException` (HTTP 503). Check Redis health via `redis-cli ping` or container logs.
- **Symptom B (HTTP 401 Unauthorized):** Token is rejected with `Invalid token` or `Session or credentials have been revoked.`.
  - **Diagnosis:**
    - Verify system clock synchronization (NTP) across nodes. JWT validation tolerates standard clock skew, but significant drift causes premature token expiration or false revocation epoch collisions.
    - Check if user underwent a password reset, session revocation, or account suspension.

---

## 7. Backup, Recovery & Secret Rotation Considerations

| Component | Procedure | Tested Status | Operational Notes |
| :--- | :--- | :--- | :--- |
| **PostgreSQL Backup** | `pg_dump -Fc` on dedicated replica | *[UNTESTED in production cluster]* | Backup must include `User`, `AuthSession`, and `OtpChallenge` tables. |
| **PostgreSQL Restore** | `pg_restore --clean --if-exists` | *[UNTESTED in production cluster]* | Restoration must occur on an offline or maintenance database before routing traffic. |
| **Redis State Recovery** | Redis AOF / RDB persistence | *[UNTESTED in production cluster]* | If Redis cache is completely wiped, active sessions remain valid in PostgreSQL, but recent token revocation timestamps will fall back to database state. |
| **JWT Secret Rotation** | Update `JWT_SECRET` | *[Dual-secret rotation UNTESTED]* | Current implementation supports a single active `JWT_SECRET`. Rotating this secret immediately invalidates all active access tokens (users will silently refresh via cookie). Zero-downtime dual-key rotation requires future JWKS key rollover support. |
| **OTP Secret Rotation** | Update `OTP_HMAC_SECRET` | *[UNTESTED on live cluster]* | Rotating `OTP_HMAC_SECRET` invalidates pending unconsumed OTP codes. Users can immediately request a new OTP code. |
| **Redis Password Rotation** | Update Redis server & env | *[UNTESTED on live cluster]* | Requires coordinated rolling restart of auth-service instances after updating Redis server auth. |

---

## 8. Verification Scope: Mock Tests vs. Real Infrastructure

To prevent false confidence, the table below clarifies what has been verified in code versus what requires real infrastructure:

| Capability / Invariant | Verified in Automated Test Suite? | Requires Real Infrastructure Testing? |
| :--- | :--- | :--- |
| **Configuration Parsing & Fail-Fast Validation** | **Yes (100% verified)** | No (offline validation) |
| **Password Hashing (Argon2id)** | **Yes (100% verified)** | No |
| **RBAC & Zero Client Trust Enforcement** | **Yes (100% verified)** | No |
| **Single-Use Refresh Token Rotation & Replay Detection** | **Yes (100% verified)** | No |
| **Degraded Dependency Readiness (HTTP 503)** | **Yes (100% verified)** | Yes (orchestrator health probe integration) |
| **Distributed Multi-Instance Redis Revocation** | **Yes (unit simulated)** | **Yes (multi-pod Kubernetes / ECS cluster testing)** |
| **Reverse Proxy `X-Forwarded-For` Sanitization** | **Yes (guard logic verified)** | **Yes (real ingress / ALB configuration testing)** |
| **Real PostgreSQL Migration Deployment** | Guard logic verified | **Yes (real staging PostgreSQL database on dedicated port)** |
| **Real Browser Cookie Delivery & Third-Party Isolation** | Supertest / HTTP verified | **Yes (cross-domain browser staging deployment)** |
