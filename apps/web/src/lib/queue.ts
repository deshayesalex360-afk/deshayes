import { Queue } from "bullmq";
import { env } from "./env";

export const jobsQueue = new Queue("video-jobs", {
  connection: { url: env.REDIS_URL },
  prefix: env.QUEUE_PREFIX,
  defaultJobOptions: {
    removeOnComplete: 100,
    removeOnFail: 200,
  },
});
