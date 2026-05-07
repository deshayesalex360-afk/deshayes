import { Queue } from "bullmq";
import { env } from "./env";

let jobsQueue: Queue | undefined;

/** Lazy so `next build` does not open Redis when route modules are loaded. */
export function getJobsQueue(): Queue {
  if (!jobsQueue) {
    jobsQueue = new Queue("video-jobs", {
      connection: { url: env.REDIS_URL },
      prefix: env.QUEUE_PREFIX,
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    });
  }
  return jobsQueue;
}
