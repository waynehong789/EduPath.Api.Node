# EduPath.Api.Node — REST API and business database ownership

This repository **owns** the Node.js/Express/TypeScript API, Prisma schema and migrations, question-bank JSON, seeding, and mandatory content-review Skill. It builds independently of `EduPath.DB.PostgreSQL`.

## Repository responsibilities

- `src/server.ts`, `src/auth.ts`, `src/db.ts`: HTTP API, authentication, Prisma access.
- `prisma/schema.prisma`, `prisma/migrations/`: canonical business data model and version-controlled migrations.
- `src/seed.ts`, `data/`: source questions and import script; imports Maths and revision in this MVP.
- `skills/SKILL.md`, `skills/CONTENT_REQUIREMENTS.md`, `scripts/validate_question_bank.py`: mandatory question-review policy and validation gate.
- `.github/workflows/question-review.yml`: validates question modifications in pull requests.

## Local setup (Node 20+, npm, Python 3, Docker)

1. Clone `EduPath.Api.Node` and `EduPath.DB.PostgreSQL` (same parent folder is convenient, **not required**).
2. In `EduPath.DB.PostgreSQL`: `cp .env.example .env` and `docker compose up -d postgres`.
3. In **this** repository: `cp .env.example .env` and `npm install`.
4. `npm run db:generate`.
5. **New empty database only:** `npm run db:migrate -- --name init` (generates initial migration; commit it).
6. `npm run validate:questions` then `npm run db:seed`.
7. `npm run dev`; health endpoint: http://localhost:4000/api/health.
8. `npm run typecheck` and `npm run build` for build checks.

On Windows PowerShell use `Copy-Item .env.example .env`. Configure `DATABASE_URL` in this repo's `.env`; do not commit credentials.

**Migration history note:** The earlier split repositories contained **no Prisma migration SQL**. This deliverable moves the actual schema into this repo and includes the migration lock; create and commit the initial migration using Prisma CLI against a **fresh** local database. For any database with existing tables/data, take a backup and baseline its current schema before running migrations. Never point `migrate dev` at production.

## Deployments

- `npm run db:deploy` applies reviewed, committed migrations using a restricted deployment job with network access to RDS.
- Apply backwards-compatible migrations before deploying API code that needs them; coordinate rollback and backups.
- `npm run build` generates Prisma Client from **local committed schema**, not from another repository.
- Configure Cognito JWKS verification, `DATABASE_URL` and `FRONTEND_ORIGIN`. Disable development authentication in production.
- `EduPath.DB.PostgreSQL` owns only the PostgreSQL infrastructure, RDS configuration and operational documentation.

## API

`GET /api/health`, `GET /api/me`, `GET /api/tests`, `POST /api/attempts`, `GET /api/attempts/:id`, `PATCH /api/attempts/:id/answers`, `POST /api/attempts/:id/submit`, `GET /api/me/results`.

Every attempt is scoped to its authenticated user. Question answers are returned only after submission/expiry, and snapshots preserve historical grading. Legacy questions are not automatically certified as independently reviewed.
