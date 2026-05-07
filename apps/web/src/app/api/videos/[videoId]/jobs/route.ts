import { desc, eq } from "drizzle-orm";
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
    orderBy: desc(schema.jobs.createdAt),
  });
  return NextResponse.json({ jobs });
}
