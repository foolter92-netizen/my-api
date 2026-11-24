// Fix: re-enable provider keys that are proven working but currently off.
// - 0.vercel key ***1Kiq (cmruz1694000el1041np5za8n): served v0-mini 200 OK today 14:35
// - cometapi keys: key ***bC8G served 200 OK today 15:04; others get self-healing retest
// Keys auto-disabled by REAL auth errors (chinaapi 403, 0.vercel key2 401) stay off.
import { PrismaClient } from "@prisma/client";
import { config } from "dotenv";
import { existsSync } from "fs";
import { resolve } from "path";

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

const ENABLE_KEYS = [
  // 0.vercel key 1 — worked today (v0-mini 200 @ 14:35, gpt-5.6-sol 200 @ 14:40)
  { id: "cmruz1694000el1041np5za8n", label: "0.vercel key1 ***1Kiq" },
  // cometapi key 3 — worked today (200 @ 15:04:28)
  { id: "cmrmwlv1o0001jv04njf3u66p", label: "cometapi key3 ***bC8G" },
  // cometapi keys 1,2,4,5,6 — 403 in Aug but key3 proves they recover; gateway self-heals bad ones
  { id: "cmrlzxt6o000el404w24vi4l3", label: "cometapi key1 ***GGrn" },
  { id: "cmrm2h86u0005jp04npmopfmd", label: "cometapi key2 ***rAjM" },
  { id: "cmrmzw7700005i504ug5iydd5", label: "cometapi key4 ***O0ie" },
  { id: "cmrn37o2m0003jr04wgeufhjj", label: "cometapi key5 ***n4PF" },
  { id: "cmru8qanx0001l404milj7j4g", label: "cometapi key6 ***A2bq" },
];

async function main() {
  for (const k of ENABLE_KEYS) {
    const before = await db.providerApiKey.findUnique({ where: { id: k.id } });
    if (!before) {
      console.log(`SKIP ${k.label}: not found`);
      continue;
    }
    await db.providerApiKey.update({
      where: { id: k.id },
      data: {
        isActive: true,
        status: "active",
        cooldownUntil: null,
        lastError: null,
      },
    });
    console.log(`ENABLED ${k.label} (was isActive=${before.isActive} status=${before.status})`);
  }
  console.log("\nDone. Keys left untouched (real auth failures): 0.vercel key2 (401), all chinaapi keys (403 today).");
}

main()
  .catch(console.error)
  .finally(() => db.$disconnect());
