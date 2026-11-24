// Check provider priorities & models to pick the right priority for v0.dev Official.
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

async function main() {
  const providers = await db.provider.findMany({
    include: { models: { select: { name: true } }, _count: { select: { apiKeys: true } } },
    orderBy: { priority: "desc" },
  });
  for (const p of providers) {
    console.log(
      `prio=${String(p.priority).padStart(4)} active=${p.isActive ? "Y" : "n"} keys=${p._count.apiKeys} protocol=${p.protocol.padEnd(11)} ${p.name} :: models=[${p.models.map((m) => m.name).join(", ").slice(0, 80)}]`
    );
  }
}

main().finally(() => db.$disconnect());
