import { eq } from "drizzle-orm";
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

async function ensureUser(email: string) {
  const existing = await db.query.users.findFirst({
    where: eq(schema.users.email, email),
  });
  if (existing) return existing;
  const [created] = await db
    .insert(schema.users)
    .values({ email, name: "Creator", plan: "FREE" })
    .returning();
  return created;
}

function queuePriorityFromPlan(plan: "FREE" | "PRO" | "SCALE"): number {
  if (plan === "SCALE") return 1;
  if (plan === "PRO") return 2;
  return 3;
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const user = await ensureUser(session.user.email);
  const videos = await db.query.videos.findMany({
    where: eq(schema.videos.userId, user.id),
  });
  return NextResponse.json({ videos });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const payload = (await req.json()) as {
    title?: string;
    sourceKey?: string;
    durationSec?: number;
  };
  if (!payload.sourceKey) {
    return NextResponse.json({ error: "sourceKey required" }, { status: 400 });
  }
  const user = await ensureUser(session.user.email);
  const idemKey = req.headers.get("x-idempotency-key");
  const replay = await replayIdempotentResponse(
    user.id,
    "videos:create",
    idemKey,
  );
  if (replay) {
    return NextResponse.json(replay.response, { status: replay.statusCode });
  }
  const rate = await enforceRateLimit(user.id, user.plan, "videos:create");
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Rate limit exceeded", retryAfterSec: rate.retryAfterSec },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSec) } },
    );
  }
  const quota = await enforceMonthlyQuota(user.id, user.plan, "videos");
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
  const [video] = await db
    .insert(schema.videos)
    .values({
      userId: user.id,
      title: payload.title ?? "Untitled video",
      sourceKey: payload.sourceKey,
      durationSec: payload.durationSec ?? 0,
    })
    .returning();

  const [job] = await db
    .insert(schema.jobs)
    .values({ videoId: video.id, type: "TRANSCRIBE" })
    .returning();
  await jobsQueue.add(
    "TRANSCRIBE",
    { jobId: job.id, videoId: video.id },
    {
      attempts: 3,
      backoff: { type: "exponential", delay: 2000 },
      removeOnComplete: 50,
      removeOnFail: 100,
      priority: queuePriorityFromPlan(user.plan),
    },
  );
  await incrementUsageCounter(user.id, "videos");

  const response = { video, job };
  await storeIdempotentResponse(
    user.id,
    "videos:create",
    idemKey,
    200,
    response,
  );
  return NextResponse.json(response);
}
