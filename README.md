# Vizard-like SaaS MVP+

Monorepo implementing the requested MVP+:
- Next.js web app (`apps/web`)
- Worker for queue jobs (`apps/worker`)
- Shared DB schema (`packages/db`)
- Shared env parsing (`packages/config`)

## Features implemented

- Auth.js session auth (credentials demo login)
- Upload presign endpoint (S3/R2 compatible)
- Video metadata persistence and queued jobs
- Job pipeline: `TRANSCRIBE` -> `SUGGEST_CLIPS` -> `EXPORT`
- Clip suggestion editing API + minimal UI
- FFmpeg export pipeline with real S3 input/output and subtitle burn-in
- Job status/progress endpoint and signed export download URL endpoint
- Docker Compose for PostgreSQL + Redis

## Local setup

1. Copy env:
   - `cp .env.example .env` (PowerShell: `Copy-Item .env.example .env`)
2. Start infra:
   - `docker compose -f infra/docker-compose.yml up -d`
3. Install dependencies:
   - `npm install`
4. Generate/migrate DB:
   - `npm run db:generate`
   - `npm run db:migrate`
5. Run apps:
   - Web: `npm run dev`
   - Worker: `npm run worker`

## Deployment split

- Web app (`apps/web`): Vercel or Node container.
- Worker (`apps/worker`): separate container/VM with `ffmpeg` installed and access to Redis/Postgres/S3.

## Notes

- `TRANSCRIBE` and `SUGGEST_CLIPS` keep deterministic fallback logic when OpenAI is unavailable.
- Worker now downloads source video from object storage and uploads exported output back to object storage.
- API routes added for runtime observability:
  - `GET /api/videos/:videoId/jobs`
  - `GET /api/videos/:videoId/download`
