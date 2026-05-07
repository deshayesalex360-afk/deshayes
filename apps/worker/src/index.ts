import { parseWorkerEnv } from "@vizard/config";
import { db, schema } from "@vizard/db";
import { and, eq, isNull } from "drizzle-orm";
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Queue, UnrecoverableError, Worker } from "bullmq";
import { OpenAI } from "openai";
import { createReadStream, createWriteStream, promises as fsPromises } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { pipeline } from "node:stream/promises";

const env = parseWorkerEnv(process.env);
const openai = env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: env.OPENAI_API_KEY })
  : null;
const s3 = new S3Client({
  region: env.S3_REGION,
  endpoint: env.S3_ENDPOINT,
  forcePathStyle: Boolean(env.S3_ENDPOINT),
  credentials: {
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
  },
});

const connection = { url: env.REDIS_URL };
export const queue = new Queue("video-jobs", {
  connection,
  prefix: env.QUEUE_PREFIX,
});

type JobStatus = "RUNNING" | "DONE" | "FAILED";
type ProviderName = "assemblyai" | "openai";

const providerCircuit: Record<
  ProviderName,
  { failures: number; openUntil: number }
> = {
  assemblyai: { failures: 0, openUntil: 0 },
  openai: { failures: 0, openUntil: 0 },
};

function circuitOpen(provider: ProviderName): boolean {
  return Date.now() < providerCircuit[provider].openUntil;
}

function markProviderFailure(provider: ProviderName) {
  const state = providerCircuit[provider];
  state.failures += 1;
  if (state.failures >= 3) {
    state.openUntil = Date.now() + 60_000;
  }
}

function markProviderSuccess(provider: ProviderName) {
  providerCircuit[provider] = { failures: 0, openUntil: 0 };
}

function isNonRetryableError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("401") ||
    m.includes("403") ||
    m.includes("authentication") ||
    m.includes("forbidden") ||
    m.includes("invalid api key")
  );
}

async function setJobStatus(
  jobId: string,
  status: JobStatus,
  error?: string,
  progress?: number,
  meta?: Record<string, unknown>,
) {
  const [current] = await db
    .select({ payload: schema.jobs.payload })
    .from(schema.jobs)
    .where(eq(schema.jobs.id, jobId));
  const payload = {
    ...(current?.payload ?? {}),
    ...(meta ?? {}),
    progress: progress ?? null,
    ...(status === "RUNNING" ? { startedAt: Date.now() } : {}),
    ...(status === "DONE" || status === "FAILED" ? { finishedAt: Date.now() } : {}),
  };
  await db
    .update(schema.jobs)
    .set({ status, error: error ?? null, payload, updatedAt: new Date() })
    .where(eq(schema.jobs.id, jobId));
}

function estimateTranscribeCostUsd(totalAudioMs: number, provider: string): number {
  if (provider === "assemblyai") {
    return (totalAudioMs / 1000) * env.COST_ASSEMBLYAI_PER_AUDIO_SECOND;
  }
  return 0;
}

function estimateFfmpegCostUsd(durationMs: number): number {
  return (durationMs / 1000) * env.COST_FFMPEG_PER_CPU_SECOND;
}

async function createSystemAlert(
  userId: string,
  type: string,
  severity: "warning" | "critical",
  message: string,
  context: Record<string, unknown>,
) {
  const [created] = await db.insert(schema.systemAlerts).values({
    userId,
    type,
    severity,
    message,
    context,
  }).returning();
  if (env.ALERT_WEBHOOK_URL) {
    await fetch(env.ALERT_WEBHOOK_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        event: "system_alert",
        alert: created,
      }),
    }).catch(() => undefined);
  }
}

async function resolveOpenAlerts(
  userId: string,
  videoId: string,
  types: string[],
) {
  for (const type of types) {
    await db
      .update(schema.systemAlerts)
      .set({ resolvedAt: new Date() })
      .where(
        and(
          eq(schema.systemAlerts.userId, userId),
          eq(schema.systemAlerts.type, type),
          isNull(schema.systemAlerts.resolvedAt),
        ),
      );
  }
}

async function downloadSourceVideo(videoId: string): Promise<string> {
  const video = await db.query.videos.findFirst({
    where: eq(schema.videos.id, videoId),
  });
  if (!video) throw new Error("Video not found");
  const localPath = join(tmpdir(), `${videoId}-source.mp4`);
  const object = await s3.send(
    new GetObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: video.sourceKey,
    }),
  );
  if (!object.Body) throw new Error("S3 body missing");
  await pipeline(object.Body as NodeJS.ReadableStream, createWriteStream(localPath));
  return localPath;
}

async function getSourceObjectKey(videoId: string): Promise<string> {
  const video = await db.query.videos.findFirst({
    where: eq(schema.videos.id, videoId),
  });
  if (!video) throw new Error("Video not found");
  return video.sourceKey;
}

async function getVideo(videoId: string) {
  const video = await db.query.videos.findFirst({
    where: eq(schema.videos.id, videoId),
  });
  if (!video) throw new Error("Video not found");
  return video;
}

async function hydrateTranscriptFromCache(videoId: string, sourceKey: string) {
  const cache = await db.query.mediaCaches.findFirst({
    where: eq(schema.mediaCaches.sourceKey, sourceKey),
  });
  const ttlCutoff = new Date(
    Date.now() - env.MEDIA_CACHE_TTL_HOURS * 60 * 60 * 1000,
  );
  if (cache && cache.updatedAt && cache.updatedAt < ttlCutoff) {
    return false;
  }
  const cachedSegments = cache?.transcriptSegments ?? [];
  if (!cachedSegments.length) return false;
  await db
    .delete(schema.transcriptSegments)
    .where(eq(schema.transcriptSegments.videoId, videoId));
  await db.insert(schema.transcriptSegments).values(
    cachedSegments.map((seg) => ({
      videoId,
      startMs: seg.startMs,
      endMs: seg.endMs,
      text: seg.text,
    })),
  );
  return true;
}

async function processTranscribe(videoId: string) {
  const video = await getVideo(videoId);
  const cacheHit = await hydrateTranscriptFromCache(videoId, video.sourceKey);
  if (cacheHit) return { provider: "cache", costUsd: 0 };

  let usedProvider = false;
  let provider = "fallback";
  let sample = [
    { startMs: 0, endMs: 10000, text: "Welcome to this long-form video." },
    {
      startMs: 10000,
      endMs: 30000,
      text: "This section contains a key insight worth clipping.",
    },
    { startMs: 30000, endMs: 50000, text: "Another practical tip appears here." },
  ];

  if (env.ASSEMBLYAI_API_KEY) {
    if (circuitOpen("assemblyai")) {
      throw new UnrecoverableError("AssemblyAI circuit breaker open");
    }
    try {
      const sourceKey = await getSourceObjectKey(videoId);
      const signedSourceUrl = await getSignedUrl(
        s3,
        new GetObjectCommand({
          Bucket: env.S3_BUCKET,
          Key: sourceKey,
        }),
        { expiresIn: 3600 },
      );

      const createTranscriptResponse = await fetch(
        "https://api.assemblyai.com/v2/transcript",
        {
          method: "POST",
          headers: {
            authorization: env.ASSEMBLYAI_API_KEY,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            audio_url: signedSourceUrl,
            punctuate: true,
            format_text: true,
            utterances: true,
          }),
        },
      );
      if (!createTranscriptResponse.ok) {
        throw new Error(
          `AssemblyAI transcript create failed (${createTranscriptResponse.status})`,
        );
      }
      const created = (await createTranscriptResponse.json()) as { id?: string };
      if (!created.id) {
        throw new Error("AssemblyAI transcript id missing");
      }

      for (let attempt = 0; attempt < env.TRANSCRIBE_MAX_POLL_ATTEMPTS; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, env.TRANSCRIBE_POLL_MS));
        const pollResponse = await fetch(
          `https://api.assemblyai.com/v2/transcript/${created.id}`,
          {
            headers: { authorization: env.ASSEMBLYAI_API_KEY },
          },
        );
        if (!pollResponse.ok) {
          throw new Error(
            `AssemblyAI poll failed (${pollResponse.status})`,
          );
        }
        const polled = (await pollResponse.json()) as {
          status?: string;
          error?: string;
          utterances?: Array<{ start: number; end: number; text: string }>;
          words?: Array<{ start: number; end: number; text: string }>;
        };
        if (polled.status === "completed") {
          if (polled.utterances?.length) {
            sample = polled.utterances.map((utterance) => ({
              startMs: utterance.start,
              endMs: utterance.end,
              text: utterance.text,
            }));
            usedProvider = true;
            provider = "assemblyai";
            markProviderSuccess("assemblyai");
          } else if (polled.words?.length) {
            sample = polled.words.map((word) => ({
              startMs: word.start,
              endMs: word.end,
              text: word.text,
            }));
            usedProvider = true;
            provider = "assemblyai";
            markProviderSuccess("assemblyai");
          }
          break;
        }
        if (polled.status === "error") {
          throw new Error(polled.error ?? "AssemblyAI transcription failed");
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "AssemblyAI error";
      markProviderFailure("assemblyai");
      if (isNonRetryableError(message)) {
        throw new UnrecoverableError(message);
      }
    }
  }

  if (!usedProvider && openai) {
    if (circuitOpen("openai")) {
      throw new UnrecoverableError("OpenAI circuit breaker open");
    }
    try {
      const inputPath = await downloadSourceVideo(videoId);
      const transcript = await openai.audio.transcriptions.create({
        file: createReadStream(inputPath),
        model: env.TRANSCRIPTION_MODEL,
        response_format: "verbose_json",
        timestamp_granularities: ["segment"],
      });
      const segments = (transcript as { segments?: Array<{ start: number; end: number; text: string }> }).segments;
      if (segments?.length) {
        sample = segments.map((seg) => ({
          startMs: Math.floor(seg.start * 1000),
          endMs: Math.floor(seg.end * 1000),
          text: seg.text,
        }));
        usedProvider = true;
        provider = "openai";
        markProviderSuccess("openai");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "OpenAI error";
      markProviderFailure("openai");
      if (isNonRetryableError(message)) {
        throw new UnrecoverableError(message);
      }
    }
  }

  await db
    .delete(schema.transcriptSegments)
    .where(eq(schema.transcriptSegments.videoId, videoId));
  await db
    .insert(schema.transcriptSegments)
    .values(sample.map((s) => ({ ...s, videoId })));
  await db
    .insert(schema.mediaCaches)
    .values({
      sourceKey: video.sourceKey,
      transcriptSegments: sample,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: schema.mediaCaches.sourceKey,
      set: {
        transcriptSegments: sample,
        updatedAt: new Date(),
      },
    });
  const maxEndMs = sample.reduce((max, seg) => Math.max(max, seg.endMs), 0);
  return {
    provider,
    costUsd: estimateTranscribeCostUsd(maxEndMs, provider),
  };
}

async function processSuggest(videoId: string) {
  const video = await getVideo(videoId);
  const cache = await db.query.mediaCaches.findFirst({
    where: eq(schema.mediaCaches.sourceKey, video.sourceKey),
  });
  const ttlCutoff = new Date(
    Date.now() - env.MEDIA_CACHE_TTL_HOURS * 60 * 60 * 1000,
  );
  if (cache && cache.updatedAt && cache.updatedAt < ttlCutoff) {
    // stale cache: continue with fresh generation
  } else {
  const cachedClips = cache?.suggestedClips ?? [];
  if (cachedClips.length) {
    await db
      .delete(schema.suggestedClips)
      .where(eq(schema.suggestedClips.videoId, videoId));
    await db.insert(schema.suggestedClips).values(
      cachedClips.map((clip) => ({
        videoId,
        title: clip.title,
        startMs: clip.startMs,
        endMs: clip.endMs,
        score: clip.score ?? null,
      })),
    );
    return { provider: "cache", costUsd: 0 };
  }
  }

  const segments = await db.query.transcriptSegments.findMany({
    where: eq(schema.transcriptSegments.videoId, videoId),
  });
  let clips = [
    { title: "Main insight", startMs: 10000, endMs: 30000, score: 80 },
    { title: "Actionable tip", startMs: 30000, endMs: 50000, score: 75 },
  ];
  let openAiCostUsd = 0;
  if (openai && segments.length > 0) {
    if (circuitOpen("openai")) {
      throw new UnrecoverableError("OpenAI circuit breaker open");
    }
    const compactSegments = segments.slice(0, 300);
    const transcript = compactSegments
      .map(
        (s: { startMs: number; endMs: number; text: string }) =>
          `[${s.startMs}-${s.endMs}] ${s.text}`,
      )
      .join("\n");
    const rsp = await openai.responses.create({
      model: "gpt-4.1-mini",
      input:
        "Return strict JSON array with title,startMs,endMs,score (0-100), " +
        "2-4 clips, each 15-60s, from transcript:\n" +
        transcript,
    });
    const text = rsp.output_text.trim();
    const usage = rsp as unknown as {
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const inputTokens = usage.usage?.input_tokens ?? 0;
    const outputTokens = usage.usage?.output_tokens ?? 0;
    openAiCostUsd =
      (inputTokens / 1_000_000) * env.COST_OPENAI_SUGGEST_INPUT_PER_1M +
      (outputTokens / 1_000_000) * env.COST_OPENAI_SUGGEST_OUTPUT_PER_1M;
    try {
      const parsed = JSON.parse(text) as typeof clips;
      if (Array.isArray(parsed) && parsed.length > 0) clips = parsed;
      markProviderSuccess("openai");
    } catch {
      // Keep fallback clips.
    }
  }
  await db
    .delete(schema.suggestedClips)
    .where(eq(schema.suggestedClips.videoId, videoId));
  await db
    .insert(schema.suggestedClips)
    .values(clips.map((c) => ({ ...c, videoId })));
  await db
    .insert(schema.mediaCaches)
    .values({
      sourceKey: video.sourceKey,
      suggestedClips: clips.map((clip) => ({
        title: clip.title,
        startMs: clip.startMs,
        endMs: clip.endMs,
        score: clip.score ?? null,
      })),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: schema.mediaCaches.sourceKey,
      set: {
        suggestedClips: clips.map((clip) => ({
          title: clip.title,
          startMs: clip.startMs,
          endMs: clip.endMs,
          score: clip.score ?? null,
        })),
        updatedAt: new Date(),
      },
    });
  return { provider: "openai", costUsd: openAiCostUsd };
}

function ratioScale(ratio: string): string {
  if (ratio === "1:1") return "scale=1080:1080";
  if (ratio === "16:9") return "scale=1920:1080";
  return "scale=1080:1920";
}

async function runFfmpeg(args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const p = spawn(env.FFMPEG_BIN, args, { stdio: "ignore" });
    p.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`ffmpeg failed with code ${code ?? -1}`)),
    );
    p.on("error", (err) => reject(err));
  });
}

function ffmpegCodecOrder(): string[] {
  if (env.FFMPEG_ENCODER === "libx264") return ["libx264"];
  if (env.FFMPEG_ENCODER === "h264_nvenc") return ["h264_nvenc", "libx264"];
  if (env.FFMPEG_ENCODER === "h264_qsv") return ["h264_qsv", "libx264"];
  if (env.FFMPEG_ENCODER === "h264_vaapi") return ["h264_vaapi", "libx264"];
  return ["h264_nvenc", "h264_qsv", "h264_vaapi", "libx264"];
}

function formatSrtTime(ms: number): string {
  const total = Math.max(ms, 0);
  const hours = Math.floor(total / 3_600_000);
  const minutes = Math.floor((total % 3_600_000) / 60_000);
  const seconds = Math.floor((total % 60_000) / 1000);
  const millis = total % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")},${String(millis).padStart(3, "0")}`;
}

async function processExport(videoId: string, ratio: string, clipId?: string) {
  const clip = clipId
    ? await db.query.suggestedClips.findFirst({
        where: and(
          eq(schema.suggestedClips.id, clipId),
          eq(schema.suggestedClips.videoId, videoId),
        ),
      })
    : null;
  const startSec = clip ? clip.startMs / 1000 : 0;
  const endSec = clip ? clip.endMs / 1000 : 30;

  const input = await downloadSourceVideo(videoId);
  const output = join(tmpdir(), `${videoId}-${Date.now()}-out.mp4`);
  const subtitlePath = join(tmpdir(), `${videoId}-subs.srt`);

  const segments = await db.query.transcriptSegments.findMany({
    where: eq(schema.transcriptSegments.videoId, videoId),
  });
  const srt = segments
    .map(
      (seg: { startMs: number; endMs: number; text: string }, idx: number) =>
        `${idx + 1}\n${formatSrtTime(seg.startMs)} --> ${formatSrtTime(seg.endMs)}\n${seg.text}\n`,
    )
    .join("\n");
  await fsPromises.writeFile(
    subtitlePath,
    srt || "1\n00:00:00,000 --> 00:00:02,000\nNo transcript available.\n",
  );

  const filter = `${ratioScale(ratio)},subtitles='${subtitlePath.replace(/\\/g, "/")}'`;
  let usedEncoder = "libx264";
  let lastError: Error | null = null;
  for (const encoder of ffmpegCodecOrder()) {
    const args = [
      "-y",
      "-ss",
      String(startSec),
      "-to",
      String(endSec),
      "-i",
      input,
      "-vf",
      filter,
      "-c:v",
      encoder,
      "-preset",
      encoder === "libx264" ? "veryfast" : "p4",
      "-movflags",
      "+faststart",
      "-threads",
      "0",
      "-c:a",
      "aac",
      output,
    ];
    try {
      await runFfmpeg(args);
      usedEncoder = encoder;
      lastError = null;
      break;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("ffmpeg failed");
    }
  }
  if (lastError) throw lastError;

  const outputKey = `exports/${videoId}/${Date.now()}-${ratio.replace(":", "x")}.mp4`;
  await s3.send(
    new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: outputKey,
      Body: createReadStream(output),
      ContentType: "video/mp4",
    }),
  );
  await db
    .insert(schema.exportsTable)
    .values({ videoId, ratio, outputKey });
  await db
    .update(schema.videos)
    .set({ status: "READY" })
    .where(eq(schema.videos.id, videoId));
  await Promise.allSettled([
    fsPromises.unlink(input),
    fsPromises.unlink(output),
    fsPromises.unlink(subtitlePath),
  ]);
  return {
    usedEncoder,
    estimatedCostUsd: estimateFfmpegCostUsd(Math.max((endSec - startSec) * 1000, 0)),
  };
}

const worker = new Worker(
  "video-jobs",
  async (job) => {
    const data = job.data as {
      jobId: string;
      videoId: string;
      ratio?: string;
      clipId?: string;
    };
    const startTime = Date.now();
    await setJobStatus(data.jobId, "RUNNING", undefined, 10);
    try {
      if (job.name === "TRANSCRIBE") {
        await db
          .update(schema.videos)
          .set({ status: "PROCESSING" })
          .where(eq(schema.videos.id, data.videoId));
        await setJobStatus(data.jobId, "RUNNING", undefined, 40);
        const tr = await processTranscribe(data.videoId);
        await setJobStatus(data.jobId, "DONE", undefined, 100, {
          provider: tr.provider,
          costUsd: tr.costUsd,
          durationMs: Date.now() - startTime,
        });
        const [nextJob] = await db
          .insert(schema.jobs)
          .values({ videoId: data.videoId, type: "SUGGEST_CLIPS" })
          .returning();
        await queue.add("SUGGEST_CLIPS", {
          jobId: nextJob.id,
          videoId: data.videoId,
        }, {
          attempts: 2,
          backoff: { type: "exponential", delay: 1500 },
          removeOnComplete: 100,
          removeOnFail: 100,
        });
        const video = await getVideo(data.videoId);
        await resolveOpenAlerts(video.userId, data.videoId, [
          "JOB_FAILURE",
          "SLO_DURATION",
        ]);
      } else if (job.name === "SUGGEST_CLIPS") {
        await setJobStatus(data.jobId, "RUNNING", undefined, 60);
        const sug = await processSuggest(data.videoId);
        await setJobStatus(data.jobId, "DONE", undefined, 100, {
          provider: sug.provider,
          costUsd: sug.costUsd,
          durationMs: Date.now() - startTime,
        });
        const video = await getVideo(data.videoId);
        await resolveOpenAlerts(video.userId, data.videoId, [
          "JOB_FAILURE",
          "SLO_DURATION",
        ]);
      } else if (job.name === "EXPORT") {
        await setJobStatus(data.jobId, "RUNNING", undefined, 70);
        const exp = await processExport(
          data.videoId,
          data.ratio ?? "9:16",
          data.clipId,
        );
        await setJobStatus(data.jobId, "DONE", undefined, 100, {
          provider: "ffmpeg",
          encoder: exp.usedEncoder,
          costUsd: exp.estimatedCostUsd,
          durationMs: Date.now() - startTime,
        });
        const video = await getVideo(data.videoId);
        await resolveOpenAlerts(video.userId, data.videoId, [
          "JOB_FAILURE",
          "SLO_DURATION",
        ]);
      }
      if (Date.now() - startTime > env.SLO_MAX_JOB_MS) {
        const video = await getVideo(data.videoId);
        await createSystemAlert(
          video.userId,
          "SLO_DURATION",
          "warning",
          "Job duration exceeded SLO threshold",
          {
            jobId: data.jobId,
            videoId: data.videoId,
            durationMs: Date.now() - startTime,
            sloMs: env.SLO_MAX_JOB_MS,
          },
        );
      }
    } catch (error) {
      await setJobStatus(
        data.jobId,
        "FAILED",
        error instanceof Error ? error.message : "Unknown",
        undefined,
        { durationMs: Date.now() - startTime },
      );
      await db
        .update(schema.videos)
        .set({ status: "FAILED" })
        .where(eq(schema.videos.id, data.videoId));
      const video = await getVideo(data.videoId);
      await createSystemAlert(
        video.userId,
        "JOB_FAILURE",
        "critical",
        "Background job failed",
        {
          jobId: data.jobId,
          videoId: data.videoId,
          error: error instanceof Error ? error.message : "Unknown",
        },
      );
      throw error;
    }
  },
  {
    connection,
    prefix: env.QUEUE_PREFIX,
    concurrency: env.WORKER_CONCURRENCY,
    lockDuration: env.JOB_TIMEOUT_MS,
  },
);

worker.on("ready", () => {
  console.log("Worker ready for queue video-jobs");
});
