// Diagnostic: inspect production DB state for all users' providers/keys/models
// NOTE: never prints full provider keys — only previews & statuses.
import { PrismaClient } from "@prisma/client";
import { config } from "dotenv";
import { existsSync } from "fs";
import { resolve } from "path";
import { createHash } from "crypto";

const gatewayPath = resolve(process.cwd(), ".gateway.env");
if (existsSync(gatewayPath)) config({ path: gatewayPath, override: true });
config({ override: true });
if (process.env.DATABASE_URL && /^file:/i.test(process.env.DATABASE_URL)) {
  process.env.DATABASE_URL =
    "postgresql://postgres.yevwwrnbuplxdvsdgnos:pkzGDUlPXAldm8iW@aws-0-eu-central-1.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1";
  process.env.DIRECT_URL =
    "postgresql://postgres.yevwwrnbuplxdvsdgnos:pkzGDUlPXAldm8iW@aws-0-eu-central-1.pooler.supabase.com:5432/postgres";
}

const db = new PrismaClient();

// sha256 of the user's master key so we can find their account
const MASTER_KEY = "gw_749814_xxWuCdB_Z_wbPUQClUUxte1uPUKR4B4w";
const hash = createHash("sha256").update(MASTER_KEY).digest("hex");

async function main() {
  // 1. find user by master key hash (try both raw & trimmed)
  let masterKey = await db.masterApiKey.findUnique({
    where: { keyHash: hash },
    include: { user: true },
  });
  if (!masterKey) {
    const mk2 = createHash("sha256").update(MASTER_KEY.trim()).digest("hex");
    masterKey = await db.masterApiKey.findUnique({
      where: { keyHash: mk2 },
      include: { user: true },
    });
  }
  if (!masterKey) {
    console.log("MASTER KEY NOT FOUND");
    return;
  }
  console.log(`USER: ${masterKey.user.email} (${masterKey.user.id}) role=${masterKey.user.role}`);
  console.log(`MASTER KEY: prefix=${masterKey.keyPrefix} active=${masterKey.isActive} lastUsed=${masterKey.lastUsedAt?.toISOString()}`);

  // recent request logs for this user (the 15:04 burst + latest)
  const logs = await db.requestLog.findMany({
    where: { userId: masterKey.userId },
    orderBy: { createdAt: "desc" },
    take: 25,
    select: {
      createdAt: true, model: true, endpointType: true, statusCode: true,
      providerName: true, success: true, retried: true, error: true, path: true,
    },
  });
  console.log("\n=== LAST 25 REQUEST LOGS ===");
  for (const l of logs) {
    console.log(
      `${l.createdAt.toISOString()} path=${l.path} model=${l.model} type=${l.endpointType} status=${l.statusCode} provider=${l.providerName} success=${l.success} retried=${l.retried} err=${(l.error || "").slice(0, 90)}`
    );
  }
}

async function dumpUser(userId: string) {
  const providers = await db.provider.findMany({
    where: { userId },
    include: {
      endpoints: true,
      models: true,
      apiKeys: { include: { healthLogs: { orderBy: { createdAt: "desc" }, take: 3 } } },
    },
    orderBy: { priority: "desc" },
  });
  console.log(`\n=== PROVIDERS (${providers.length}) ===`);
  for (const p of providers) {
    console.log(`\n[${p.isActive ? "ACTIVE" : "OFF"}] ${p.name} (id=${p.id}) priority=${p.priority} protocol=${p.protocol}`);
    console.log(`  baseUrl=${p.baseUrl} auth=${p.authHeader}:${p.authScheme} timeout=${p.timeoutMs}ms`);
    console.log(`  endpoints: ${p.endpoints.map((e) => `${e.type}→${e.method} ${e.path}`).join(" | ") || "NONE!"}`);
    console.log(`  models(${p.models.filter((m) => m.isActive).length}/${p.models.length}): ${p.models.map((m) => `${m.name}${m.isActive ? "" : "(off)"}`).join(", ") || "NONE"}`);
    for (const k of p.apiKeys) {
      const cd = k.cooldownUntil ? k.cooldownUntil.toISOString() : null;
      const cdState = cd && new Date(cd) > new Date() ? " (COOLDOWN ACTIVE)" : cd ? " (expired)" : "";
      console.log(`  KEY "${k.name || "-"}" id=${k.id} isActive=${k.isActive} status=${k.status} cooldown=${cd}${cdState}`);
      console.log(`    preview=***${k.keyPreview} req=${k.totalRequests} ok=${k.totalSuccess} err=${k.totalErrors} lastUsed=${k.lastUsedAt?.toISOString() || "-"}`);
      console.log(`    lastError=${k.lastError || "-"} @${k.lastErrorAt?.toISOString() || "-"}`);
      for (const h of k.healthLogs) {
        console.log(`    health: ${h.createdAt.toISOString()} ${h.event} code=${h.statusCode} msg=${(h.message || "").slice(0, 100)}`);
      }
    }
    if (p.apiKeys.length === 0) console.log("  >>> NO KEYS CONFIGURED <<<");
  }
}

async function dumpAll() {
  const users = await db.user.findMany({ include: { providers: true } });
  for (const u of users) {
    console.log(`USER ${u.email} (${u.id}) providers=${u.providers.length}`);
    await dumpUser(u.id);
  }
}

main()
  .catch(console.error)
  .finally(() => db.$disconnect());
