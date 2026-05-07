"use client";

import { useState } from "react";

type Clip = {
  id: string;
  title: string;
  startMs: number;
  endMs: number;
};

export function ClipEditor({
  videoId,
  initialClips,
}: {
  videoId: string;
  initialClips: Clip[];
}) {
  const [clips, setClips] = useState(initialClips);
  const [jobStatus, setJobStatus] = useState("idle");
  const [downloadUrl, setDownloadUrl] = useState("");

  async function refreshJobs() {
    const response = await fetch(`/api/videos/${videoId}/jobs`);
    if (!response.ok) return;
    const data = (await response.json()) as {
      jobs: Array<{ type: string; status: string; payload?: { progress?: number } }>;
    };
    const latest = data.jobs[0];
    if (!latest) return;
    const progress = latest.payload?.progress;
    setJobStatus(
      progress != null
        ? `${latest.type}: ${latest.status} (${progress}%)`
        : `${latest.type}: ${latest.status}`,
    );
  }

  async function updateClip(clip: Clip) {
    await fetch(`/api/clips/${clip.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(clip),
    });
  }

  return (
    <section className="mt-8 rounded border p-4">
      <div className="mb-4 flex gap-3">
        <button
          onClick={async () => {
            await fetch(`/api/videos/${videoId}/suggest`, { method: "POST" });
            await refreshJobs();
          }}
          className="rounded bg-black px-3 py-2 text-sm text-white"
        >
          Generate clips
        </button>
        <button
          onClick={async () => {
            await fetch(`/api/videos/${videoId}/export`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ratio: "9:16" }),
            });
            await refreshJobs();
          }}
          className="rounded border px-3 py-2 text-sm"
        >
          Export 9:16
        </button>
        <button
          onClick={refreshJobs}
          className="rounded border px-3 py-2 text-sm"
        >
          Refresh jobs
        </button>
        <button
          onClick={async () => {
            const response = await fetch(`/api/videos/${videoId}/download`);
            if (!response.ok) return;
            const data = (await response.json()) as { downloadUrl: string };
            setDownloadUrl(data.downloadUrl);
          }}
          className="rounded border px-3 py-2 text-sm"
        >
          Get download link
        </button>
      </div>
      <p className="mb-4 text-sm text-zinc-600">Job status: {jobStatus}</p>
      {downloadUrl && (
        <a
          href={downloadUrl}
          target="_blank"
          rel="noreferrer"
          className="mb-4 inline-block text-sm underline"
        >
          Download latest export
        </a>
      )}
      <ul className="grid gap-3">
        {clips.map((clip) => (
          <li key={clip.id} className="rounded border p-3">
            <input
              className="mb-2 w-full rounded border p-2"
              value={clip.title}
              onChange={(e) => {
                setClips((prev) =>
                  prev.map((c) =>
                    c.id === clip.id ? { ...c, title: e.target.value } : c,
                  ),
                );
              }}
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                className="rounded border p-2"
                type="number"
                value={clip.startMs}
                onChange={(e) =>
                  setClips((prev) =>
                    prev.map((c) =>
                      c.id === clip.id
                        ? { ...c, startMs: Number(e.target.value) }
                        : c,
                    ),
                  )
                }
              />
              <input
                className="rounded border p-2"
                type="number"
                value={clip.endMs}
                onChange={(e) =>
                  setClips((prev) =>
                    prev.map((c) =>
                      c.id === clip.id ? { ...c, endMs: Number(e.target.value) } : c,
                    ),
                  )
                }
              />
            </div>
            <button
              className="mt-2 rounded border px-3 py-1 text-sm"
              onClick={() => updateClip(clip)}
            >
              Save clip
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
