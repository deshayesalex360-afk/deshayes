import Redis from "ioredis";

const redis = new Redis(process.env.REDIS_URL ?? "", {
  maxRetriesPerRequest: 1,
  enableOfflineQueue: false,
});

type Plan = "FREE" | "PRO" | "SCALE";
type Action = "videos:create" | "clips:suggest" | "videos:export" | "uploads:presign";

const limits: Record<Plan, Record<Action, number>> = {
  FREE: {
    "videos:create": 10,
    "clips:suggest": 20,
    "videos:export": 10,
    "uploads:presign": 30,
  },
  PRO: {
    "videos:create": 40,
    "clips:suggest": 120,
    "videos:export": 60,
    "uploads:presign": 180,
  },
  SCALE: {
    "videos:create": 200,
    "clips:suggest": 1000,
    "videos:export": 500,
    "uploads:presign": 3000,
  },
};

export async function enforceRateLimit(
  userId: string,
  plan: Plan,
  action: Action,
  windowSeconds = 60,
) {
  const max = limits[plan][action];
  const bucket = Math.floor(Date.now() / (windowSeconds * 1000));
  const key = `ratelimit:${action}:${userId}:${bucket}`;
  const current = await redis.incr(key);
  if (current === 1) {
    await redis.expire(key, windowSeconds + 5);
  }
  return {
    allowed: current <= max,
    limit: max,
    remaining: Math.max(0, max - current),
    retryAfterSec: windowSeconds,
  };
}
