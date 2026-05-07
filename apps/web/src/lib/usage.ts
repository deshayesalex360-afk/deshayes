import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { env } from "@/lib/env";

type Plan = "FREE" | "PRO" | "SCALE";
type UsageAction = "uploads" | "videos" | "suggest" | "exports";

const monthlyQuota: Record<
  Plan,
  { uploads: number; videos: number; suggest: number; exports: number }
> = {
  FREE: { uploads: 200, videos: 60, suggest: 300, exports: 80 },
  PRO: { uploads: 2000, videos: 600, suggest: 5000, exports: 1200 },
  SCALE: { uploads: 50000, videos: 15000, suggest: 200000, exports: 60000 },
};

function monthKey(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

export async function getOrCreateUsageCounter(userId: string, now = new Date()) {
  const key = monthKey(now);
  const existing = await db.query.usageCounters.findFirst({
    where: and(
      eq(schema.usageCounters.userId, userId),
      eq(schema.usageCounters.monthKey, key),
    ),
  });
  if (existing) return existing;
  const [created] = await db
    .insert(schema.usageCounters)
    .values({ userId, monthKey: key })
    .returning();
  return created;
}

export async function enforceMonthlyQuota(userId: string, plan: Plan, action: UsageAction) {
  const counter = await getOrCreateUsageCounter(userId);
  const current =
    action === "uploads"
      ? counter.uploadsCount
      : action === "videos"
        ? counter.videosCreatedCount
        : action === "suggest"
          ? counter.suggestCount
          : counter.exportCount;
  const limit = monthlyQuota[plan][action];
  return {
    allowed: current < limit,
    used: current,
    remaining: Math.max(0, limit - current),
    limit,
  };
}

export async function incrementUsageCounter(userId: string, action: UsageAction) {
  const key = monthKey();
  const setClause =
    action === "uploads"
      ? { uploadsCount: sql`${schema.usageCounters.uploadsCount} + 1` }
      : action === "videos"
        ? { videosCreatedCount: sql`${schema.usageCounters.videosCreatedCount} + 1` }
        : action === "suggest"
          ? { suggestCount: sql`${schema.usageCounters.suggestCount} + 1` }
          : { exportCount: sql`${schema.usageCounters.exportCount} + 1` };

  await db
    .insert(schema.usageCounters)
    .values({ userId, monthKey: key })
    .onConflictDoUpdate({
      target: [schema.usageCounters.userId, schema.usageCounters.monthKey],
      set: {
        ...setClause,
        updatedAt: new Date(),
      },
    });
}

export async function getMonthlyCostUsd(userId: string): Promise<number> {
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  const videos = await db.query.videos.findMany({
    where: eq(schema.videos.userId, userId),
  });
  const videoIds = videos.map((v) => v.id);
  if (videoIds.length === 0) return 0;

  const jobs = await db.query.jobs.findMany({
    where: and(
      inArray(schema.jobs.videoId, videoIds),
      gte(schema.jobs.createdAt, monthStart),
    ),
  });
  return jobs.reduce((sum, job) => {
    const cost = (job.payload as { costUsd?: unknown })?.costUsd;
    return sum + (typeof cost === "number" ? cost : 0);
  }, 0);
}

export async function enforceMonthlyCostBudget(userId: string, plan: Plan) {
  const spentUsd = await getMonthlyCostUsd(userId);
  const budgetUsd =
    plan === "SCALE"
      ? env.BUDGET_SCALE_USD
      : plan === "PRO"
        ? env.BUDGET_PRO_USD
        : env.BUDGET_FREE_USD;
  return {
    allowed: spentUsd < budgetUsd,
    spentUsd,
    budgetUsd,
    remainingUsd: Math.max(0, budgetUsd - spentUsd),
  };
}
