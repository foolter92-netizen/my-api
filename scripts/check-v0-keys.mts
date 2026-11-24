// Inspect v0.dev provider keys; disable any key that isn't the official team key.
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
const PROVIDER_ID = "cmwuxp16i0001l5076iie73xa";
const KEEP_PREVIEW = "7d7g"; // official team key

async function main() {
  const keys = await db.providerApiKey.findMany({
    where: { providerId: PROVIDER_ID },
    select: { id: true, name: true, keyPreview: true, isActive: true, status: true },
  });
  console.log("keys on v0.dev provider:");
  for (const k of keys) {
    console.log(` - ${k.keyPreview} name=${k.name} active=${k.isActive} status=${k.status}`);
    if (k.keyPreview !== KEEP_PREVIEW && k.isActive) {
      await db.providerApiKey.update({
        where: { id: k.id },
        data: { isActive: false, status: "disabled", lastError: "superseded by official v0.dev team key" },
      });
      console.log(`   -> disabled (not the official key)`);
    }
  }
}

main().finally(() => db.$disconnect());
