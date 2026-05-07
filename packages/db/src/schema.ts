import {
  integer,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const videoStatusEnum = pgEnum("video_status", [
  "UPLOADED",
  "PROCESSING",
  "READY",
  "FAILED",
]);
export const jobTypeEnum = pgEnum("job_type", [
  "TRANSCRIBE",
  "SUGGEST_CLIPS",
  "EXPORT",
]);
export const jobStatusEnum = pgEnum("job_status", [
  "PENDING",
  "RUNNING",
  "DONE",
  "FAILED",
]);
export const userPlanEnum = pgEnum("user_plan", ["FREE", "PRO", "SCALE"]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 255 }),
  plan: userPlanEnum("plan").default("FREE").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const videos = pgTable(
  "videos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 255 }).notNull(),
    sourceKey: text("source_key").notNull(),
    durationSec: integer("duration_sec").default(0),
    status: videoStatusEnum("status").default("UPLOADED").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    userCreatedIdx: index("videos_user_created_idx").on(
      table.userId,
      table.createdAt,
    ),
    statusIdx: index("videos_status_idx").on(table.status),
  }),
);

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    videoId: uuid("video_id")
      .notNull()
      .references(() => videos.id, { onDelete: "cascade" }),
    type: jobTypeEnum("type").notNull(),
    status: jobStatusEnum("status").default("PENDING").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().default({}),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    videoCreatedIdx: index("jobs_video_created_idx").on(
      table.videoId,
      table.createdAt,
    ),
    statusIdx: index("jobs_status_idx").on(table.status),
  }),
);

export const transcriptSegments = pgTable(
  "transcript_segments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    videoId: uuid("video_id")
      .notNull()
      .references(() => videos.id, { onDelete: "cascade" }),
    startMs: integer("start_ms").notNull(),
    endMs: integer("end_ms").notNull(),
    text: text("text").notNull(),
  },
  (table) => ({
    videoStartIdx: index("segments_video_start_idx").on(table.videoId, table.startMs),
  }),
);

export const suggestedClips = pgTable(
  "suggested_clips",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    videoId: uuid("video_id")
      .notNull()
      .references(() => videos.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 255 }).notNull(),
    startMs: integer("start_ms").notNull(),
    endMs: integer("end_ms").notNull(),
    score: integer("score"),
  },
  (table) => ({
    videoScoreIdx: index("clips_video_score_idx").on(table.videoId, table.score),
  }),
);

export const exportsTable = pgTable(
  "exports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    videoId: uuid("video_id")
      .notNull()
      .references(() => videos.id, { onDelete: "cascade" }),
    ratio: varchar("ratio", { length: 10 }).notNull(),
    outputKey: text("output_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    videoCreatedIdx: index("exports_video_created_idx").on(
      table.videoId,
      table.createdAt,
    ),
  }),
);

export const mediaCaches = pgTable(
  "media_caches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceKey: text("source_key").notNull().unique(),
    transcriptSegments: jsonb("transcript_segments")
      .$type<Array<{ startMs: number; endMs: number; text: string }>>()
      .default([]),
    suggestedClips: jsonb("suggested_clips")
      .$type<Array<{ title: string; startMs: number; endMs: number; score: number | null }>>()
      .default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    updatedAtIdx: index("media_caches_updated_idx").on(table.updatedAt),
  }),
);

export const usageCounters = pgTable(
  "usage_counters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    monthKey: varchar("month_key", { length: 7 }).notNull(), // YYYY-MM
    uploadsCount: integer("uploads_count").default(0).notNull(),
    videosCreatedCount: integer("videos_created_count").default(0).notNull(),
    suggestCount: integer("suggest_count").default(0).notNull(),
    exportCount: integer("export_count").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    userMonthIdx: index("usage_user_month_idx").on(table.userId, table.monthKey),
    userMonthUnique: uniqueIndex("usage_user_month_unique").on(
      table.userId,
      table.monthKey,
    ),
  }),
);

export const systemAlerts = pgTable(
  "system_alerts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: varchar("type", { length: 64 }).notNull(),
    severity: varchar("severity", { length: 16 }).notNull(),
    message: text("message").notNull(),
    context: jsonb("context").$type<Record<string, unknown>>().default({}),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    userCreatedIdx: index("alerts_user_created_idx").on(table.userId, table.createdAt),
    severityIdx: index("alerts_severity_idx").on(table.severity),
  }),
);

export const requestIdempotencies = pgTable(
  "request_idempotencies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    routeKey: varchar("route_key", { length: 128 }).notNull(),
    idemKey: varchar("idem_key", { length: 255 }).notNull(),
    response: jsonb("response").$type<Record<string, unknown>>().default({}),
    statusCode: integer("status_code").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    userRouteIdemUnique: uniqueIndex("idem_user_route_key_unique").on(
      table.userId,
      table.routeKey,
      table.idemKey,
    ),
  }),
);
