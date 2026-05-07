import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import { env } from "@/lib/env";
import { s3 } from "@/lib/s3";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ videoId: string }> },
) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { videoId } = await params;
  const latestExport = await db.query.exportsTable.findFirst({
    where: eq(schema.exportsTable.videoId, videoId),
    orderBy: desc(schema.exportsTable.createdAt),
  });
  if (!latestExport) {
    return NextResponse.json({ error: "No export found" }, { status: 404 });
  }
  const command = new GetObjectCommand({
    Bucket: env.S3_BUCKET,
    Key: latestExport.outputKey,
  });
  const downloadUrl = await getSignedUrl(s3, command, { expiresIn: 900 });
  return NextResponse.json({ downloadUrl, outputKey: latestExport.outputKey });
}
