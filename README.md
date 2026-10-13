# AI Recruitment Preparation Ecosystem (AREP) — AIInterview

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D24.14.0-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![pnpm](https://img.shields.io/badge/pnpm-%3E%3D10.32.1-F69220?logo=pnpm&logoColor=white)](https://pnpm.io/)
[![Next.js](https://img.shields.io/badge/Next.js-15.5-000000?logo=next.js&logoColor=white)](https://nextjs.org/)
[![NestJS](https://img.shields.io/badge/NestJS-12.1-E0234E?logo=nestjs&logoColor=white)](https://nestjs.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-Strict-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Prisma](https://img.shields.io/badge/Prisma-5.15-2D3748?logo=prisma&logoColor=white)](https://www.prisma.io/)
[![License](https://img.shields.io/badge/License-Proprietary-blue.svg)]()

> A modern, microservice-based AI recruitment and technical interview ecosystem designed for scalable candidate preparation, adaptive assessments, coding execution, AI-driven mock interviews, and automated evaluation.

---

## 🌟 Overview

The **AI Recruitment Preparation Ecosystem (AREP)** is built as a modular monorepo powering candidate discovery, skill verification, and multi-modal AI interviewing. 

The platform currently includes the production-grade **Authentication, Core Identity, and Security Foundation (Member 1 Scope)**, along with a responsive Next.js frontend and shared architectural contracts.

---

## 🏗️ Workspace Architecture

This repository is managed with `pnpm` workspaces:

```
interview/
├── apps/
│   └── web/                     # Next.js 15 App Router Frontend (Port 3000)
│       ├── src/app/             # Pages: Landing, Sign-in, Sign-up, OTP, Password Reset
│       └── src/lib/             # Typed API Client, Auth Context, In-memory Token Store
│
├── services/
│   └── auth-service/            # NestJS 12 Authentication Microservice (Port 3001)
│       ├── prisma/              # PostgreSQL schema (users, roles, sessions, otps) & migrations
│       └── src/                 # Identity, JWT, Argon2id, OTP, Session, RBAC, Rate Limiting
│
├── packages/
│   ├── shared-types/            # Canonical contracts (RoleName, AuthenticatedPrincipal)
│   ├── ui-kit/                  # Reusable accessible UI components (Button, Badge, Card)
│   └── config/                  # Shared TypeScript, ESLint, and tool configs
│
├── docs/                        # Complete operational runbooks & handoff specs
│   ├── member-1-auth-handoff.md # Final ownership boundary & module integration guide
│   ├── auth-staging-handoff.md  # Staging deployment checklist & smoke-test runbook
│   ├── auth-service-operations.md # Health probes, CLI validation & disaster recovery
│   └── local-development.md    # Local Docker Compose infrastructure setup
│
└── infra/                       # Infrastructure-as-code & container descriptors
    └── docker/                  # Local compose setup (PostgreSQL, Redis, Mailpit)
```

---

## 🔐 Key Features (Authentication & Core Identity)

- **Argon2id Password Hashing**: OWASP-aligned cryptographic configuration (`m=65536`, `t=3`, `p=4`).
- **Two-Step Authentication**: Step 1 validates password; Step 2 gates on a 6-digit cryptographic email OTP challenge before issuing session tokens.
- **Single-Use Refresh Token Rotation**:
  - Compares and swaps tokens atomically in PostgreSQL and HttpOnly cookies.
  - Automatic **replay attack detection** revokes all active user sessions upon reused tokens.
- **Zero-Storage of Raw Secrets**:
  - OTP codes are hashed via HMAC-SHA256 (`OTP_HMAC_SECRET`); raw OTPs are never stored in the database.
  - Refresh tokens in sessions are stored as SHA-256 verifier hashes.
  - Bearer access tokens are held exclusively in frontend JavaScript memory (never written to `localStorage` or `document.cookies`).
- **Role-Based Access Control (RBAC)**:
  - Canonical roles: `CANDIDATE`, `RECRUITER`, `COMPANY_HR`, `MODERATOR`, `ADMIN`, `SUPER_ADMIN`.
  - Declarative `@Roles(...)` and `@AllowAnyRole()` guards with strict fail-closed defaults.
- **Session & Password Governance**:
  - 5-entry password history preventing reuse of prior passwords.
  - Session revocation on logout, password change, account suspension, or compromise.
- **Fail-Closed Distributed Revocation**:
  - Real-time revocation checking via Redis (`auth:revoked:user:<id>`, `auth:revoked:session:<id>`).
  - Throws `ServiceUnavailableException` (HTTP 503) during Redis outages to prevent unauthorized bypass.
- **CORS & CSRF Defense**:
  - Strict Origin and Referer validation on cookie-authenticated routes (`/auth/refresh`, `/auth/logout`).
  - Refresh token cookie attributes: `HttpOnly`, `SameSite=Lax`, `Secure`, `Path=/auth`.
- **Pre-Flight Configuration Validation**:
  - Offline validator (`pnpm auth:validate-config`) verifies all variables and rejects weak secrets without opening network connections.

---

## 🚀 Getting Started

### Prerequisites

- **Node.js**: `>= 24.14.0` (LTS recommended)
- **pnpm**: `>= 10.32.1` (`npm install -g pnpm`)
- **Docker** *(optional, for local PostgreSQL/Redis/Mailpit)*

### 1. Installation

Clone the repository and install all workspace dependencies:

```bash
git clone https://github.com/BinaryLoops/AIInterview.git
cd AIInterview
pnpm install
```

### 2. Configure Environment

Copy the local development environment template:

```bash
# On Linux/macOS
cp .env.example .env

# On Windows PowerShell
Copy-Item .env.example .env
```

> **Note on Local Mode**: In `.env`, `DATABASE_ENABLED=false`, `REDIS_ENABLED=false`, and `SMTP_ENABLED=false` by default, allowing the service to run out-of-the-box using safe in-memory test stores without needing external Docker databases.

### 3. Validate Configuration (Offline Pre-Flight)

Run the non-destructive configuration validator:

```bash
pnpm auth:validate-config
```

### 4. Run the Development Servers

Start both the frontend (`apps/web`) and backend (`services/auth-service`) in parallel watch mode:

```bash
pnpm dev
```

Once started:
- **Web Frontend**: [http://localhost:3000](http://localhost:3000)
- **Auth Microservice**: [http://127.0.0.1:3001](http://127.0.0.1:3001)
- **Liveness Health Check**: [http://127.0.0.1:3001/health](http://127.0.0.1:3001/health)
- **Readiness Dependency Probe**: [http://127.0.0.1:3001/ready](http://127.0.0.1:3001/ready)

---

## 🧪 Available Scripts

| Command | Description |
| :--- | :--- |
| `pnpm dev` | Starts all applications in parallel watch mode (`web` on 3000, `auth-service` on 3001) |
| `pnpm test` | Runs all unit and integration test suites across the monorepo |
| `pnpm typecheck` | Executes strict TypeScript typechecking across all 5 workspace projects |
| `pnpm auth:validate-config` | Runs the offline configuration validator CLI |
| `pnpm --filter auth-service build` | Compiles the backend NestJS service bundle to `dist/` |
| `pnpm --filter web build` | Builds the production Next.js frontend bundle |
| `pnpm infra:up` | Boots local Docker Compose services (PostgreSQL on 5432, Redis on 6379, Mailpit on 8025) |
| `pnpm infra:down` | Stops local Docker Compose containers |

---

## 📡 API Reference Overview

The authentication service mounts the following endpoints under `/auth`:

| Method | Route | Description |
| :--- | :--- | :--- |
| `POST` | `/auth/register` | Register new candidate account with password |
| `POST` | `/auth/verify-email` | Verify email address using 6-digit numeric OTP |
| `POST` | `/auth/login` | Step 1 login (password check; dispatches login OTP) |
| `POST` | `/auth/verify-login-otp` | Step 2 login (consumes OTP; issues JWT & sets HttpOnly cookie) |
| `POST` | `/auth/refresh` | Rotates refresh token via cookie/body; returns new access token |
| `POST` | `/auth/logout` | Revokes active session and clears HttpOnly refresh cookie |
| `POST` | `/auth/forgot-password` | Initiates password reset challenge |
| `POST` | `/auth/reset-password` | Verifies reset OTP and updates password (checks history) |
| `GET` | `/health` | Liveness probe (`{"status":"ok","service":"auth-service"}`) |
| `GET` | `/ready` | Readiness probe (verifies database & Redis connectivity) |

For complete DTO shapes, rate limits, and error formats, see [`docs/member-1-auth-handoff.md`](docs/member-1-auth-handoff.md).

---

## 📚 Documentation & Runbooks

- **[Member 1 Final Handoff Runbook](docs/member-1-auth-handoff.md)**: Ownership boundaries, API contracts, canonical roles, and integration checklist for other platform modules.
- **[Staging Integration Runbook](docs/auth-staging-handoff.md)**: Production/staging environment variable matrix, secret generation, provisioning commands, and 8-step smoke tests.
- **[Operations & Deployment Guide](docs/auth-service-operations.md)**: Health probes, logging standards, failure recovery, and diagnostic playbook.
- **[Local Infrastructure Setup](docs/local-development.md)**: Docker Compose setup for local PostgreSQL, Redis, and Mailpit.

---

## 🔒 Security Best Practices

- **Zero Secret Commits**: Real production credentials must **never** be committed to source control. `.env` is permanently excluded via `.gitignore`.
- **CSPRNG Entropy**: Cryptographic secrets (`JWT_SECRET`, `OTP_HMAC_SECRET`) must be generated with at least 256 bits of entropy:
  ```bash
  openssl rand -hex 32
  ```
- **Masked Logs**: Authentication logs strictly redact passwords, raw OTPs, and token values.

---

## 📄 License

Proprietary — AI Recruitment Preparation Ecosystem (AREP). All rights reserved.