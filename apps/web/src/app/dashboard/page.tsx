import { desc, eq } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { logoutAction } from "@/app/actions";
import { db, schema } from "@/lib/db";

function monthKey(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.email) redirect("/");

  const user = await db.query.users.findFirst({
    where: eq(schema.users.email, session.user.email),
  });
  const videos = user
    ? await db.query.videos.findMany({
        where: eq(schema.videos.userId, user.id),
        orderBy: desc(schema.videos.createdAt),
      })
    : [];
  const usage = user
    ? await db.query.usageCounters.findFirst({
        where: (u, { and, eq }) =>
          and(eq(u.userId, user.id), eq(u.monthKey, monthKey())),
      })
    : null;

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <form action={logoutAction}>
          <button className="rounded border px-3 py-2 text-sm">Sign out</button>
        </form>
      </div>

      <section className="rounded border p-4">
        <h2 className="mb-4 font-medium">Create video metadata</h2>
        <p className="text-sm text-zinc-600">
          plan={user?.plan ?? "FREE"} month={monthKey()}
        </p>
        {usage && (
          <p className="mt-1 text-sm text-zinc-600">
            usage: uploads={usage.uploadsCount}, videos={usage.videosCreatedCount},
            suggest={usage.suggestCount}, exports={usage.exportCount}
          </p>
        )}
        <p className="text-sm text-zinc-600">
          Call `/api/uploads/presign`, upload to S3/R2, then POST
          `/api/videos` with `sourceKey`.
        </p>
        <p className="mt-1 text-sm text-zinc-600">
          feature flags: GET `/api/features` | perf analytics: GET `/api/analytics/overview`
        </p>
      </section>

      <section className="mt-6 rounded border p-4">
        <h2 className="mb-3 font-medium">Videos</h2>
        <ul className="grid gap-3">
          {videos.map((video) => (
            <li key={video.id} className="rounded border p-3">
              <p className="font-medium">{video.title}</p>
              <p className="text-sm text-zinc-600">
                status={video.status} duration={video.durationSec}s
              </p>
              <Link
                className="mt-2 inline-block text-sm underline"
                href={`/dashboard/videos/${video.id}`}
              >
                Open editor
              </Link>
            </li>
          ))}
          {videos.length === 0 && (
            <li className="text-sm text-zinc-500">No videos yet.</li>
          )}
        </ul>
      </section>
    </main>
  );
}
