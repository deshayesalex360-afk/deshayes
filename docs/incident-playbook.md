# Incident Playbook

## Severity Levels

- P1: Core flow down (upload, transcribe, export unavailable for majority of users)
- P2: Degraded service (latency/cost spike, partial provider outage)
- P3: Non-critical bug with workaround

## First 10 Minutes

1. Check `GET /api/analytics/overview` for failure rate, p95 duration, open alerts.
2. Inspect latest `system_alerts` entries (`JOB_FAILURE`, `SLO_DURATION`).
3. Verify provider health:
   - AssemblyAI API status
   - OpenAI API status
   - S3/R2 connectivity
   - Redis and Postgres availability
4. If budget cap triggered unexpectedly, review `monthlyCost` fields.

## Immediate Mitigations

- If transcription provider unstable:
  - Reduce `WORKER_CONCURRENCY`
  - Increase `TRANSCRIBE_POLL_MS`
  - Keep circuit breaker active (auto in worker)
- If export overloaded:
  - Force `FFMPEG_ENCODER=libx264` for predictable fallback
  - Temporarily lower free-plan priorities and quotas
- If rate limits too strict:
  - Raise limits per plan in `rate-limit.ts`

## Recovery Validation

1. Create a canary video and run full flow: upload -> transcribe -> suggest -> export.
2. Confirm no new critical alert appears for 15 minutes.
3. Confirm p95 and failure rate are back under SLO.

## Post-Incident

- Document root cause.
- Add regression test or alert rule.
- Tune budgets, quotas, or retry policy to prevent recurrence.
