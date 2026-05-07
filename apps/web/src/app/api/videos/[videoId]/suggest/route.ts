import { and, eq, or } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import {
  replayIdempotentResponse,
  storeIdempotentResponse,
} from "@/lib/idempotency";
import { jobsQueue } from "@/lib/queue";
import { enforceRateLimit } from "@/lib/rate-limit";
import {
  enforceMonthlyCostBudget,
  enforceMonthlyQuota,
  incrementUsageCounter,
} from "@/lib/usage";

function queuePriorityFromPlan(plan: "FREE" | "PRO" | "SCALE"): number {
  if (plan === "SCALE") return 1;
  if (plan === "PRO") return 2;
  return 3;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ videoId: string }> },
) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { videoId } = await params;
  const user = await db.query.users.findFirst({
    where: eq(schema.users.email, session.user.email),
  });
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  const video = await db.query.videos.findFirst({
    where: and(eq(schema.videos.id, videoId), eq(schema.videos.userId, user.id)),
  });
  if (!video) {
    return NextResponse.json({ error: "Video not found" }, { status: 404 });
  }
  const idemKey = req.headers.get("x-idempotency-key");
  const replay = await replayIdempotentResponse(
    user.id,
    `videos:${videoId}:suggest`,
    idemKey,
  );
  if (replay) {
    return NextResponse.json(replay.response, { status: replay.statusCode });
  }
  const rate = await enforceRateLimit(user.id, user.plan, "clips:suggest");
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Rate limit exceeded", retryAfterSec: rate.retryAfterSec },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSec) } },
    );
  }
  const quota = await enforceMonthlyQuota(user.id, user.plan, "suggest");
  if (!quota.allowed) {
    return NextResponse.json(
      { error: "Monthly quota exceeded", limit: quota.limit },
      { status: 429 },
    );
  }
  const budget = await enforceMonthlyCostBudget(user.id, user.plan);
  if (!budget.allowed) {
    return NextResponse.json(
      { error: "Monthly budget exceeded", budgetUsd: budget.budgetUsd },
      { status: 429 },
    );
  }
  const inFlight = await db.query.jobs.findFirst({
    where: and(
      eq(schema.jobs.videoId, videoId),
      eq(schema.jobs.type, "SUGGEST_CLIPS"),
      or(eq(schema.jobs.status, "PENDING"), eq(schema.jobs.status, "RUNNING")),
    ),
  });
  if (inFlight) {
    return NextResponse.json({ ok: true, jobId: inFlight.id, deduped: true });
  }
  const [job] = await db
    .insert(schema.jobs)
    .values({ videoId, type: "SUGGEST_CLIPS" })
    .returning();
  await jobsQueue.add(
    "SUGGEST_CLIPS",
    { jobId: job.id, videoId },
    {
      attempts: 2,
      backoff: { type: "exponential", delay: 1500 },
      removeOnComplete: 100,
      removeOnFail: 100,
      priority: queuePriorityFromPlan(user.plan),
    },
  );
  await incrementUsageCounter(user.id, "suggest");
  const response = { ok: true, jobId: job.id };
  await storeIdempotentResponse(
    user.id,
    `videos:${videoId}:suggest`,
    idemKey,
    200,
    response,
  );
  return NextResponse.json(response);
}
