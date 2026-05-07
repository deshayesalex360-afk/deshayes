import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db, schema } from "@/lib/db";
import { ClipEditor } from "./ui";

export default async function VideoDetailPage({
  params,
}: {
  params: Promise<{ videoId: string }>;
}) {
  const { videoId } = await params;
  const video = await db.query.videos.findFirst({
    where: eq(schema.videos.id, videoId),
  });
  if (!video) notFound();

  const clips = await db.query.suggestedClips.findMany({
    where: eq(schema.suggestedClips.videoId, videoId),
  });

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <h1 className="text-2xl font-semibold">{video.title}</h1>
      <p className="mt-1 text-sm text-zinc-600">Source key: {video.sourceKey}</p>
      <ClipEditor videoId={video.id} initialClips={clips} />
    </main>
  );
}
