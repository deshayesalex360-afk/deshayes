import Redis from "ioredis";

let redis: Redis | undefined;

function getRedis(): Redis {
  const url = process.env.REDIS_URL?.trim();
  if (!url) {
    throw new Error(
      "REDIS_URL is missing. Add your Redis URL to the environment (same value as the worker).",
    );
  }
  if (!redis) {
    redis = new Redis(url, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      lazyConnect: true,
    });
    redis.on("error", () => {
      /* avoid unhandled 'error' event when Redis is unreachable */
    });
  }
  return redis;
}

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
  const r = getRedis();
  const current = await r.incr(key);
  if (current === 1) {
    await r.expire(key, windowSeconds + 5);
  }
  return {
    allowed: current <= max,
    limit: max,
    remaining: Math.max(0, max - current),
    retryAfterSec: windowSeconds,
  };
}
