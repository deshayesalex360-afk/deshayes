import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ videoId: string }> },
) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { videoId } = await params;
  const jobs = await db.query.jobs.findMany({
    where: eq(schema.jobs.videoId, videoId),
  });
  const summary = jobs.map((job) => ({
    id: job.id,
    type: job.type,
    status: job.status,
    durationMs:
      typeof (job.payload as { durationMs?: unknown })?.durationMs === "number"
        ? (job.payload as { durationMs: number }).durationMs
        : null,
    provider:
      typeof (job.payload as { provider?: unknown })?.provider === "string"
        ? (job.payload as { provider: string }).provider
        : null,
    error: job.error,
  }));
  return NextResponse.json({ videoId, jobs: summary });
}
