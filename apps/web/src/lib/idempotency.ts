import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";

export async function replayIdempotentResponse(
  userId: string,
  routeKey: string,
  idemKey: string | null,
) {
  if (!idemKey) return null;
  const existing = await db.query.requestIdempotencies.findFirst({
    where: and(
      eq(schema.requestIdempotencies.userId, userId),
      eq(schema.requestIdempotencies.routeKey, routeKey),
      eq(schema.requestIdempotencies.idemKey, idemKey),
    ),
  });
  if (!existing) return null;
  return {
    statusCode: existing.statusCode,
    response: existing.response,
  };
}

export async function storeIdempotentResponse(
  userId: string,
  routeKey: string,
  idemKey: string | null,
  statusCode: number,
  response: Record<string, unknown>,
) {
  if (!idemKey) return;
  await db
    .insert(schema.requestIdempotencies)
    .values({ userId, routeKey, idemKey, statusCode, response })
    .onConflictDoNothing();
}
