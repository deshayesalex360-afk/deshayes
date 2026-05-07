import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");

function readEnvFile(envPath) {
  const text = fs.readFileSync(envPath, "utf8");
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const idx = line.indexOf("=");
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    env[key] = value;
  }
  return env;
}

function parseRedisHostPort(redisUrl) {
  try {
    const u = new URL(redisUrl);
    return { host: u.hostname, port: Number(u.port || 6379) };
  } catch {
    return { host: "localhost", port: 6379 };
  }
}

function parsePgHostPort(databaseUrl) {
  try {
    const u = new URL(databaseUrl);
    return { host: u.hostname, port: Number(u.port || 5432) };
  } catch {
    return { host: "localhost", port: 5432 };
  }
}

function tcpCheck(host, port, timeoutMs = 2500) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    let done = false;
    const finish = (ok, message) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve({ ok, message });
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true, `${host}:${port} reachable`));
    socket.once("timeout", () => finish(false, `${host}:${port} timeout`));
    socket.once("error", (e) => finish(false, `${host}:${port} error: ${e.message}`));
  });
}

function checkFfmpeg() {
  const result = spawnSync("ffmpeg", ["-version"], { encoding: "utf8" });
  return result.status === 0;
}

function checkForPlaceholderSecrets(env) {
  const bad = [];
  const placeholders = new Set(["", "xxx", "replace-with-strong-secret"]);
  for (const key of [
    "S3_ACCESS_KEY_ID",
    "S3_SECRET_ACCESS_KEY",
    "AUTH_SECRET",
    "ASSEMBLYAI_API_KEY",
  ]) {
    const value = env[key] ?? "";
    if (placeholders.has(value)) bad.push(key);
  }
  return bad;
}

async function migrationHealth(databaseUrl) {
  const migrationsDir = path.join(root, "packages", "db", "drizzle");
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  let dbCount = 0;
  try {
    const q1 = await client.query(
      "select count(*)::int as c from drizzle.__drizzle_migrations",
    );
    dbCount = q1.rows[0]?.c ?? 0;
  } catch {
    const q2 = await client.query(
      'select count(*)::int as c from "__drizzle_migrations"',
    );
    dbCount = q2.rows[0]?.c ?? 0;
  } finally {
    await client.end();
  }
  return {
    fileCount: files.length,
    dbCount,
    ok: dbCount >= files.length,
  };
}

async function main() {
  const envPath = path.join(root, ".env");
  if (!fs.existsSync(envPath)) {
    console.error("FAIL .env file missing");
    process.exit(1);
  }
  const env = readEnvFile(envPath);
  const required = [
    "DATABASE_URL",
    "REDIS_URL",
    "S3_BUCKET",
    "S3_REGION",
    "S3_ACCESS_KEY_ID",
    "S3_SECRET_ACCESS_KEY",
    "AUTH_SECRET",
  ];
  const missing = required.filter((k) => !env[k]);
  const placeholderIssues = checkForPlaceholderSecrets(env);
  const pgTarget = parsePgHostPort(env.DATABASE_URL || "");
  const redisTarget = parseRedisHostPort(env.REDIS_URL || "");
  const [pgHealth, redisHealth] = await Promise.all([
    tcpCheck(pgTarget.host, pgTarget.port),
    tcpCheck(redisTarget.host, redisTarget.port),
  ]);
  const ffmpegOk = checkFfmpeg();

  let migrations = { fileCount: 0, dbCount: 0, ok: false };
  try {
    migrations = await migrationHealth(env.DATABASE_URL || "");
  } catch (e) {
    console.log(`WARN migration check skipped: ${e.message}`);
  }

  console.log("== Preprod Audit ==");
  console.log(`ENV missing: ${missing.length ? missing.join(", ") : "none"}`);
  console.log(
    `ENV placeholders: ${placeholderIssues.length ? placeholderIssues.join(", ") : "none"}`,
  );
  console.log(`Postgres: ${pgHealth.ok ? "OK" : "FAIL"} (${pgHealth.message})`);
  console.log(`Redis: ${redisHealth.ok ? "OK" : "FAIL"} (${redisHealth.message})`);
  console.log(`FFmpeg: ${ffmpegOk ? "OK" : "FAIL"}`);
  console.log(
    `Migrations: ${migrations.ok ? "OK" : "WARN"} (db=${migrations.dbCount}, files=${migrations.fileCount})`,
  );

  const failed =
    missing.length > 0 ||
    placeholderIssues.length > 0 ||
    !pgHealth.ok ||
    !redisHealth.ok ||
    !ffmpegOk;

  if (failed) {
    console.error("Preprod audit failed");
    process.exit(1);
  }
  console.log("Preprod audit passed");
}

await main();
