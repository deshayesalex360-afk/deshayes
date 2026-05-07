import { z } from "zod";

const optionalUrl = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.url().optional(),
);

const sharedSchema = z.object({
  DATABASE_URL: z.url(),
  REDIS_URL: z.string().min(1),
  S3_BUCKET: z.string().min(1),
  S3_REGION: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_ENDPOINT: z.string().optional(),
  APP_BASE_URL: z.url(),
  OPENAI_API_KEY: z.string().optional(),
  ASSEMBLYAI_API_KEY: z.string().optional(),
  QUEUE_PREFIX: z.string().default("vizard"),
  ALERT_WEBHOOK_URL: optionalUrl,
});

export const webEnvSchema = sharedSchema.extend({
  AUTH_SECRET: z.string().min(16),
  DEMO_EMAIL: z.email().default("demo@vizard.local"),
  DEMO_PASSWORD: z.string().min(8).default("change-me-123"),
  MAX_UPLOAD_MB: z.coerce.number().int().positive().default(512),
  MAX_DURATION_SECONDS: z.coerce.number().int().positive().default(7200),
  BUDGET_FREE_USD: z.coerce.number().positive().default(10),
  BUDGET_PRO_USD: z.coerce.number().positive().default(250),
  BUDGET_SCALE_USD: z.coerce.number().positive().default(5000),
});

export const workerEnvSchema = sharedSchema.extend({
  FFMPEG_BIN: z.string().default("ffmpeg"),
  TRANSCRIPTION_MODEL: z.string().default("gpt-4o-mini-transcribe"),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(4),
  JOB_TIMEOUT_MS: z.coerce.number().int().positive().default(900000),
  FFMPEG_ENCODER: z.string().default("auto"),
  TRANSCRIBE_POLL_MS: z.coerce.number().int().positive().default(2000),
  TRANSCRIBE_MAX_POLL_ATTEMPTS: z.coerce.number().int().positive().default(90),
  MEDIA_CACHE_TTL_HOURS: z.coerce.number().int().positive().default(168),
  SLO_MAX_JOB_MS: z.coerce.number().int().positive().default(300000),
  COST_ASSEMBLYAI_PER_AUDIO_SECOND: z.coerce.number().positive().default(0.00007),
  COST_OPENAI_SUGGEST_INPUT_PER_1M: z.coerce.number().positive().default(0.4),
  COST_OPENAI_SUGGEST_OUTPUT_PER_1M: z.coerce.number().positive().default(1.6),
  COST_FFMPEG_PER_CPU_SECOND: z.coerce.number().positive().default(0.00002),
});

export type WebEnv = z.infer<typeof webEnvSchema>;
export type WorkerEnv = z.infer<typeof workerEnvSchema>;

export function parseWebEnv(input: Record<string, string | undefined>): WebEnv {
  return webEnvSchema.parse(input);
}

export function parseWorkerEnv(
  input: Record<string, string | undefined>,
): WorkerEnv {
  return workerEnvSchema.parse(input);
}
