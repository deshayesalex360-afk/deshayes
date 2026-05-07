import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ alertId: string }> },
) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { alertId } = await params;
  const user = await db.query.users.findFirst({
    where: eq(schema.users.email, session.user.email),
  });
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  const [resolved] = await db
    .update(schema.systemAlerts)
    .set({ resolvedAt: new Date() })
    .where(
      and(
        eq(schema.systemAlerts.id, alertId),
        eq(schema.systemAlerts.userId, user.id),
        isNull(schema.systemAlerts.resolvedAt),
      ),
    )
    .returning();

  return NextResponse.json({ ok: Boolean(resolved), alert: resolved ?? null });
}
