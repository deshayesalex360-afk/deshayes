import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ clipId: string }> },
) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { clipId } = await params;
  const body = (await req.json()) as {
    startMs?: number;
    endMs?: number;
    title?: string;
  };

  const [updated] = await db
    .update(schema.suggestedClips)
    .set({
      startMs: body.startMs,
      endMs: body.endMs,
      title: body.title,
    })
    .where(eq(schema.suggestedClips.id, clipId))
    .returning();

  return NextResponse.json({ clip: updated });
}
