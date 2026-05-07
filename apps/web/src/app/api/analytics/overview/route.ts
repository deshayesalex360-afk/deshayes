import { and, desc, eq, gte, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import { enforceMonthlyCostBudget, getMonthlyCostUsd } from "@/lib/usage";

function monthKey(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const user = await db.query.users.findFirst({
    where: eq(schema.users.email, session.user.email),
  });
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const videos = await db.query.videos.findMany({
    where: eq(schema.videos.userId, user.id),
  });
  const videoIds = videos.map((v) => v.id);
  const jobs =
    videoIds.length === 0
      ? []
      : await db.query.jobs.findMany({
          where: and(gte(schema.jobs.createdAt, since)),
          orderBy: desc(schema.jobs.createdAt),
        });
  const ownJobs = jobs.filter((j) => videoIds.includes(j.videoId));
  const normalized = ownJobs.map((job) => {
    const payload = job.payload as {
      provider?: string;
      durationMs?: number;
      costUsd?: number;
    };
    const provider = typeof payload?.provider === "string" ? payload.provider : null;
    const durationMs =
      typeof payload?.durationMs === "number" ? payload.durationMs : null;
    return {
      status: job.status,
      type: job.type,
      provider,
      durationMs,
      costUsd: typeof payload?.costUsd === "number" ? payload.costUsd : 0,
    };
  });
  const usage = await db.query.usageCounters.findFirst({
    where: and(
      eq(schema.usageCounters.userId, user.id),
      eq(schema.usageCounters.monthKey, monthKey()),
    ),
  });

  const alerts = await db.query.systemAlerts.findMany({
    where: and(eq(schema.systemAlerts.userId, user.id), isNull(schema.systemAlerts.resolvedAt)),
    orderBy: desc(schema.systemAlerts.createdAt),
  });
  const budget = await enforceMonthlyCostBudget(user.id, user.plan);
  const monthlyCostUsd = await getMonthlyCostUsd(user.id);

  return NextResponse.json({
    plan: user.plan,
    last24h: {
      jobsTotal: normalized.length,
      jobsFailed: normalized.filter((j) => j.status === "FAILED").length,
      cacheHitRate:
        normalized.length === 0
          ? 0
          : normalized.filter((j) => j.provider === "cache").length /
            normalized.length,
      p95DurationMs: normalized
        .map((j) => j.durationMs ?? 0)
        .sort((a, b) => a - b)[Math.floor(normalized.length * 0.95)] ?? 0,
      estimatedCostUsd: normalized.reduce((sum, j) => sum + j.costUsd, 0),
    },
    monthlyUsage: usage ?? null,
    monthlyCost: {
      spentUsd: monthlyCostUsd,
      budgetUsd: budget.budgetUsd,
      remainingUsd: budget.remainingUsd,
      allowed: budget.allowed,
    },
    openAlerts: alerts.slice(0, 20),
  });
}
