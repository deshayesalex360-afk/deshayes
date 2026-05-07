import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import { env } from "@/lib/env";
import {
  replayIdempotentResponse,
  storeIdempotentResponse,
} from "@/lib/idempotency";
import { enforceRateLimit } from "@/lib/rate-limit";
import {
  enforceMonthlyCostBudget,
  enforceMonthlyQuota,
  incrementUsageCounter,
} from "@/lib/usage";
import { s3 } from "@/lib/s3";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const user = await db.query.users.findFirst({
    where: eq(schema.users.email, session.user.email ?? ""),
  });
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  const rate = await enforceRateLimit(user.id, user.plan, "uploads:presign");
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Rate limit exceeded", retryAfterSec: rate.retryAfterSec },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSec) } },
    );
  }
  const quota = await enforceMonthlyQuota(user.id, user.plan, "uploads");
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

  const body = (await req.json()) as {
    fileName?: string;
    contentType?: string;
    fileSize?: number;
  };
  const fileName = body.fileName ?? "upload.mp4";
  const contentType = body.contentType ?? "video/mp4";
  const fileSize = body.fileSize ?? 0;
  const maxBytes = env.MAX_UPLOAD_MB * 1024 * 1024;
  if (fileSize > maxBytes) {
    return NextResponse.json({ error: "File too large" }, { status: 400 });
  }

  const objectKey = `uploads/${session.user.email}/${Date.now()}-${fileName}`;
  const idemKey = req.headers.get("x-idempotency-key");
  const replay = await replayIdempotentResponse(
    user.id,
    "uploads:presign",
    idemKey,
  );
  if (replay) {
    return NextResponse.json(replay.response, { status: replay.statusCode });
  }
  const command = new PutObjectCommand({
    Bucket: env.S3_BUCKET,
    Key: objectKey,
    ContentType: contentType,
  });
  const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 900 });
  await incrementUsageCounter(user.id, "uploads");
  const response = { uploadUrl, objectKey };
  await storeIdempotentResponse(
    user.id,
    "uploads:presign",
    idemKey,
    200,
    response,
  );
  return NextResponse.json(response);
}
