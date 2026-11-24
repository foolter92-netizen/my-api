import { db } from "@/lib/db";
import { encrypt, preview, sha256 } from "@/lib/crypto";
import { audit, getClientIp } from "@/lib/audit";
import { invalidateUserCache } from "@/lib/proxy/cache";

export const runtime = "nodejs";

/**
 * Programmatic provider provisioning endpoint.
 *
 * Lets the account owner create or update a provider (with endpoint, models
 * and an encrypted API key) WITHOUT the dashboard, using a master API key.
 * This is how official APIs whose keys were obtained outside the dashboard
 * (e.g. v0.dev) are imported: the key is encrypted server-side with the
 * production ENCRYPTION_KEY, never stored in plaintext.
 *
 * POST /api/admin/provision
 * Authorization: Bearer <master key gw_...>
 * {
 *   "name": "v0.dev Official",
 *   "baseUrl": "https://api.v0.dev",
 *   "protocol": "v0",
 *   "authHeader": "Authorization",
 *   "authScheme": "bearer",
 *   "priority": 10,
 *   "timeoutMs": 180000,
 *   "endpoints": [{ "type": "chat", "path": "/v1/chats", "method": "POST" }],
 *   "models": ["v0-mini", "openai/gpt-4o-mini"],
 *   "key": "v1:team_...:vcp_...",
 *   "keyName": "team key"
 * }
 *
 * Idempotent: an existing provider with the same (user, name) is updated in
 * place; a key whose preview already exists on that provider is not
 * duplicated.
 */

interface ProvisionBody {
  name?: string;
  baseUrl?: string;
  protocol?: string;
  authHeader?: string;
  authScheme?: string;
  priority?: number;
  timeoutMs?: number;
  isActive?: boolean;
  endpoints?: Array<{ type: string; path: string; method?: string }>;
  models?: string[];
  key?: string;
  keyName?: string;
}

function jsonError(status: number, message: string) {
  return Response.json({ error: message }, { status });
}

export async function POST(req: Request) {
  // ── Auth: master API key (same scheme the proxy uses) ──
  const authHeader = req.headers.get("authorization") || "";
  const xApiKey = req.headers.get("x-api-key") || "";
  const raw =
    (authHeader && authHeader.replace(/^bearer\s+/i, "").trim()) ||
    xApiKey.trim();
  if (!raw) return jsonError(401, "Missing master API key.");

  const masterKey = await db.masterApiKey.findUnique({
    where: { keyHash: sha256(raw) },
    select: { id: true, userId: true, isActive: true },
  });
  if (!masterKey || !masterKey.isActive) {
    return jsonError(401, "Invalid or disabled master API key.");
  }
  const userId = masterKey.userId;

  // ── Body validation ──
  let body: ProvisionBody;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "Invalid JSON body.");
  }

  const name = body.name?.trim();
  const baseUrl = body.baseUrl?.trim().replace(/\/+$/, "");
  if (!name || !baseUrl) {
    return jsonError(400, "name and baseUrl are required.");
  }
  try {
    const u = new URL(baseUrl);
    if (u.protocol !== "https:") {
      return jsonError(400, "baseUrl must be https.");
    }
  } catch {
    return jsonError(400, "baseUrl must be a valid URL.");
  }

  const key = body.key?.trim();
  if (!key) return jsonError(400, "key is required.");

  const endpoints = (body.endpoints ?? [])
    .filter((e) => e?.type?.trim() && e?.path?.trim())
    .slice(0, 10)
    .map((e) => ({ type: e.type.trim(), path: e.path.trim(), method: (e.method || "POST").trim().toUpperCase() }));
  const models = [...new Set((body.models ?? []).map((m) => String(m).trim()).filter(Boolean))].slice(0, 50);

  // ── Upsert provider (by user + name) ──
  const existing = await db.provider.findFirst({
    where: { userId, name },
    include: { endpoints: true, models: true },
  });

  const sharedData = {
    baseUrl,
    protocol: body.protocol?.trim() || "transparent",
    authHeader: body.authHeader?.trim() || "Authorization",
    authScheme: body.authScheme?.trim() || "bearer",
    priority: body.priority ?? 0,
    timeoutMs: body.timeoutMs ?? 120000,
    isActive: body.isActive ?? true,
  };

  let provider;
  if (existing) {
    provider = await db.provider.update({
      where: { id: existing.id },
      data: sharedData,
      include: { endpoints: true, models: true },
    });
  } else {
    provider = await db.provider.create({
      data: {
        userId,
        name,
        ...sharedData,
        endpoints: endpoints.length
          ? { create: endpoints.map((e) => ({ type: e.type, path: e.path, method: e.method })) }
          : undefined,
        models: models.length ? { create: models.map((m) => ({ name: m })) } : undefined,
      },
      include: { endpoints: true, models: true },
    });
  }

  // ── Ensure endpoints exist (provider may have been created earlier) ──
  for (const e of endpoints) {
    const has = provider.endpoints.some((pe) => pe.type === e.type);
    if (!has) {
      await db.providerEndpoint.create({
        data: { providerId: provider.id, type: e.type, path: e.path, method: e.method },
      });
    }
  }

  // ── Ensure models exist ──
  const haveNames = new Set(provider.models.map((m) => m.name));
  const missing = models.filter((m) => !haveNames.has(m));
  if (missing.length) {
    await db.model.createMany({
      data: missing.map((m) => ({ providerId: provider.id, name: m })),
    });
  }

  // ── Add the encrypted key unless a key with the same preview exists ──
  const keyPreview = preview(key);
  const existingKeys = await db.providerApiKey.findMany({
    where: { providerId: provider.id },
    select: { keyPreview: true, isActive: true },
  });
  const keyExists = existingKeys.some((k) => k.keyPreview === keyPreview);
  let keyRecord: { id: string; keyPreview: string; status: string } | null = null;
  if (!keyExists) {
    keyRecord = await db.providerApiKey.create({
      data: {
        providerId: provider.id,
        name: body.keyName?.trim() || null,
        encryptedKey: encrypt(key),
        keyPreview,
        isActive: true,
        status: "active",
      },
      select: { id: true, keyPreview: true, status: true },
    });
  }

  await audit({
    userId,
    action: keyExists ? "provision_provider" : "provision_provider_key",
    entity: "provider",
    entityId: provider.id,
    details: { name, baseUrl, protocol: sharedData.protocol, keyAdded: !keyExists },
    ipAddress: getClientIp(req),
  });
  invalidateUserCache(userId);

  return Response.json(
    {
      provider: {
        id: provider.id,
        name: provider.name,
        baseUrl: provider.baseUrl,
        protocol: provider.protocol,
        priority: provider.priority,
        timeoutMs: provider.timeoutMs,
        endpoints: provider.endpoints.map((e) => ({ type: e.type, path: e.path })),
        models: [...provider.models.map((m) => m.name), ...missing],
      },
      key: keyRecord
        ? { added: true, id: keyRecord.id, preview: keyRecord.keyPreview }
        : { added: false, reason: "key with same preview already exists" },
    },
    { status: keyExists ? 200 : 201 }
  );
}
