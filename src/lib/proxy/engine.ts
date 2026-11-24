import { db } from "@/lib/db";
import { decrypt, sha256 } from "@/lib/crypto";
import { detectEndpointType, parseModel, safeParseJson, type EndpointType } from "./detect";
import { classifyResponse } from "./errors";
import {
  openaiToAnthropicRequest,
  anthropicToOpenAIResponse,
} from "./translate";
import {
  chatToResponsesRequest,
  responsesToChatResponse,
} from "./responses-translate";
import { getCachedProviders, markKeyStateInCache, resetProviderKeysInCache, markKeyInFlight, clearKeyInFlight, isKeyInFlight, type CachedProvider, type CachedKey } from "./cache";

export interface ProxyResult {
  response: Response;
  meta: {
    providerId: string | null;
    providerKeyId: string | null;
    providerName: string | null;
    model: string | null;
    endpointType: EndpointType;
    retried: number;
    success: boolean;
  };
}

export interface ProxyError {
  status: number;
  message: string;
  meta: ProxyResult["meta"];
}

/** HTTP headers we never forward to the upstream provider. */
const STRIP_REQ_HEADERS = new Set([
  "host",
  "connection",
  "content-length",
  "cf-connecting-ip",
  "cf-ipcountry",
  "cf-ray",
  "cf-visitor",
  "x-forwarded-for",
  "x-forwarded-proto",
  "x-real-ip",
  "true-client-ip",
  "x-vercel-forwarded-for",
  "x-vercel-proxy-signed",
  "x-vercel-deployment-url",
  "x-vercel-id",
  "x-gateway-token", // our own
  "anthropic-version", // strip — only for Anthropic providers, not others
  "anthropic-beta", // strip — only for Anthropic providers
]);

/** Max bytes of an upstream error body to read for classification. */
const MAX_ERROR_BODY = 2048;

/**
 * Main transparent proxy entrypoint.
 *
 * Performance design:
 *  - Provider/key graph is served from an in-memory cache (5s TTL) so routing
 *    decisions don't hit the DB on the hot path.
 *  - All DB WRITES (key health update, request log, master-key touch) are
 *    fire-and-forget — they run in the background and never block the
 *    request or the next key rotation. This is what makes key switching
 *    "rocket-fast": a failed key triggers a background write while the
 *    gateway immediately tries the next key.
 *  - Error bodies are capped at 2KB so a huge upstream error page can't
 *    stall classification.
 *  - Key rotation is a tight CPU loop (filter+sort) over cached data.
 */
export async function handleProxyRequest(req: Request): Promise<Response> {
  const startedAt = Date.now();
  const method = req.method;
  const url = new URL(req.url);
  const path = url.pathname;

  // ── 1. Authenticate via master API key ────────────────────────────
  const authHeader = req.headers.get("authorization");
  const xApiKey = req.headers.get("x-api-key");
  let masterKeyRaw: string | null = null;
  if (authHeader && /bearer/i.test(authHeader)) {
    masterKeyRaw = authHeader.replace(/^bearer\s+/i, "").trim();
  } else if (authHeader) {
    masterKeyRaw = authHeader.trim();
  } else if (xApiKey) {
    masterKeyRaw = xApiKey.trim();
  }

  const meta: ProxyResult["meta"] = {
    providerId: null,
    providerKeyId: null,
    providerName: null,
    model: null,
    endpointType: "custom",
    retried: 0,
    success: false,
  };

  if (!masterKeyRaw) {
    return jsonError(401, "Missing API key. Send it via Authorization: Bearer <key> or x-api-key.", meta);
  }

  const masterKey = await db.masterApiKey.findUnique({
    where: { keyHash: sha256(masterKeyRaw) },
    select: { id: true, userId: true, isActive: true },
  });
  if (!masterKey || !masterKey.isActive) {
    return jsonError(401, "Invalid or disabled API key.", meta);
  }

  const userId = masterKey.userId;

  // ── 2. Detect endpoint type ───────────────────────────────────────
  const detected = detectEndpointType(path);
  meta.endpointType = detected.type;

  // ── 3. Read & parse body (for model discovery) ────────────────────
  const bodyBuffer = method !== "GET" && method !== "HEAD" ? await req.arrayBuffer() : null;
  const bodyText = bodyBuffer ? new TextDecoder().decode(bodyBuffer) : "";
  const bodyJson = bodyText ? safeParseJson(bodyText) : null;
  const model = parseModel(bodyJson);
  meta.model = model;

  // ── 4. Discover candidate providers (from cache — hot path) ───────
  const providers = await getCachedProviders(userId);

  // Only consider providers that have an endpoint of the requested type.
  // ALSO include providers with protocol="responses" that have a 'responses'
  // endpoint (they serve chat requests via translation).
  const withEndpoint = providers.filter((p) =>
    p.endpoints.some((e) => e.type === detected.type) ||
    (p.protocol === "responses" && p.endpoints.some((e) => e.type === "responses"))
  );

  // Filter by model support: a provider matches if it lists the model OR has
  // no models configured (wildcard provider).
  let candidates: CachedProvider[];
  if (model) {
    candidates = withEndpoint.filter(
      (p) => p.models.length === 0 || p.models.some((m) => m.name === model)
    );
    if (candidates.length === 0) {
      // No provider explicitly supports this model — fall back to wildcards
      // (providers with no models list) which might still accept it.
      candidates = withEndpoint.filter((p) => p.models.length === 0);
      if (candidates.length === 0) candidates = withEndpoint;
    }
  } else {
    candidates = withEndpoint;
  }

  if (candidates.length === 0) {
    return jsonError(
      404,
      model
        ? `No provider available for model "${model}" on ${detected.type} endpoint.`
        : `No provider available for ${detected.type} endpoint.`,
      meta
    );
  }

  // ── 5. Iterate providers & keys (rotation + failover) ─────────────
  // We do up to 3 passes: if all attempts got 5xx (transient provider
  // errors), retry because the provider may have recovered. Keys are NOT
  // penalized for 5xx (they stay 'active'), so each pass retries them all.
  let onlyHad5xxErrors = true;
  for (let pass = 0; pass < 3; pass++) {
    const now = Date.now();
  for (const provider of candidates) {
    // Determine which endpoint to use. If the provider speaks the Responses
    // protocol, always use its 'responses' endpoint (the gateway converts
    // chat completions → responses transparently). Otherwise use the endpoint
    // matching the client's requested type.
    let endpoint = provider.endpoints.find((e) => e.type === detected.type);
    if (provider.protocol === "responses") {
      endpoint = provider.endpoints.find((e) => e.type === "responses") || endpoint;
    }
    if (!endpoint) continue;

    // On pass > 0, force-recover ALL non-disabled keys to 'active' so we
    // can retry them. 5xx didn't penalize them, but some may have stale
    // 'error' state from a previous request. Clear it.
    if (pass > 0) {
      for (const k of provider.apiKeys) {
        if (k.isActive && k.status !== "disabled" && k.status !== "exhausted") {
          k.status = "active";
          k.cooldownUntil = null;
        }
      }
    }

    // Order keys: usable first (not disabled / not in cooldown / not
    // in-flight), least errors, least recently used. Disabled and in-flight
    // keys are skipped entirely so a bad or busy key never wastes a round-trip.
    const usableKeys = provider.apiKeys
      .filter((k) => isKeyUsable(k, now) && !isKeyInFlight(k.id))
      .sort((a, b) => {
        // Active (healthy) keys first
        const aHealthy = a.status === "active" ? 0 : 1;
        const bHealthy = b.status === "active" ? 0 : 1;
        if (aHealthy !== bHealthy) return aHealthy - bHealthy;
        // Then least errors
        if (a.totalErrors !== b.totalErrors) return a.totalErrors - b.totalErrors;
        // Then least recently used
        const aUsed = a.lastUsedAt?.getTime() ?? 0;
        const bUsed = b.lastUsedAt?.getTime() ?? 0;
        return aUsed - bUsed;
      });

    if (usableKeys.length === 0) continue;

    for (const key of usableKeys) {
      // Re-check usability RIGHT BEFORE trying — a concurrent request may
      // have disabled this key or put it in cooldown while we were iterating.
      // This double-check is what makes concurrent bursts efficient: we never
      // waste an HTTP call on a key that was just marked bad by a sibling.
      if (!isKeyUsable(key, Date.now()) || isKeyInFlight(key.id)) {
        continue;
      }
      meta.retried += 1;
      // Mark in-flight so concurrent requests skip this key while we try it
      markKeyInFlight(key.id);

      let decryptedKey: string;
      try {
        decryptedKey = decrypt(key.encryptedKey);
      } catch {
        clearKeyInFlight(key.id);
        markKeyBackground(userId, key.id, { action: "disable", reason: "decrypt_failed" });
        continue;
      }

      // Build target URL: provider baseUrl + endpoint path + original query
      const base = provider.baseUrl.replace(/\/+$/, "");
      let epRaw = endpoint.path.startsWith("/") ? endpoint.path : `/${endpoint.path}`;
      // ── Dynamic model interpolation ──
      // Providers like kie.ai embed the model name in the URL path, e.g.
      //   /{model}/v1/chat/completions  →  /gpt-5-2/v1/chat/completions
      // If the path contains {model}, substitute it with the actual model.
      if (epRaw.includes("{model}")) {
        if (!model) {
          // Can't resolve the path without a model — skip this key/provider.
          clearKeyInFlight(key.id);
          continue;
        }
        epRaw = epRaw.replace(/\{model\}/g, encodeURIComponent(model));
      }
      const target = new URL(base + epRaw);
      target.search = url.search;

      // Build forwarded headers (transparent, swap auth only)
      const fwdHeaders = new Headers();
      req.headers.forEach((value, name) => {
        if (!STRIP_REQ_HEADERS.has(name.toLowerCase())) {
          fwdHeaders.set(name, value);
        }
      });
      // Replace auth with the provider key
      fwdHeaders.delete("authorization");
      fwdHeaders.delete("x-api-key");
      if (provider.authScheme === "bearer" || provider.authScheme === "raw") {
        if (provider.authHeader.toLowerCase() === "authorization") {
          fwdHeaders.set(
            "Authorization",
            provider.authScheme === "bearer" ? `Bearer ${decryptedKey}` : decryptedKey
          );
        } else {
          fwdHeaders.set(provider.authHeader, decryptedKey);
        }
      } else if (provider.authScheme === "x-api-key") {
        fwdHeaders.set("x-api-key", decryptedKey);
      } else {
        fwdHeaders.set(provider.authHeader, decryptedKey);
      }

      const init: RequestInit = {
        method,
        headers: fwdHeaders,
        redirect: "follow",
      };

      // ── Protocol translation (optional) ──
      const isAnthropicProvider = provider.protocol === "anthropic";
      const isResponsesProvider = provider.protocol === "responses";
      if (bodyBuffer && method !== "GET" && method !== "HEAD") {
        if (isAnthropicProvider && bodyJson) {
          const translated = openaiToAnthropicRequest(bodyJson);
          init.body = JSON.stringify(translated);
          if (!fwdHeaders.has("anthropic-version")) {
            fwdHeaders.set("anthropic-version", "2023-06-01");
          }
        } else if (isResponsesProvider && bodyJson) {
          // Convert Chat Completions (messages) → Responses API (input)
          const translated = chatToResponsesRequest(bodyJson);
          init.body = JSON.stringify(translated);
        } else {
          init.body = bodyBuffer;
        }
      }

      // Provider timeout so a hanging upstream doesn't block rotation.
      const timeoutMs = Math.min(Math.max(provider.timeoutMs || 120000, 5000), 300000);
      try {
        init.signal = AbortSignal.timeout(timeoutMs);
      } catch {
        // AbortSignal.timeout may be unavailable in very old runtimes.
      }

      let upstream: Response;
      try {
        upstream = await fetch(target.toString(), init);
      } catch (err) {
        // network error / timeout — fire-and-forget the DB write, move on NOW
        clearKeyInFlight(key.id);
        const isTimeout =
          (err as Error).name === "TimeoutError" ||
          (err as Error).name === "AbortError";
        markKeyBackground(userId, key.id, {
          action: "error",
          reason: isTimeout
            ? `timeout_${timeoutMs}ms`
            : `network: ${(err as Error).message}`,
        });
        continue;
      }

      const status = upstream.status;

      // ── Success — stream the raw response back transparently ──
      if (status >= 200 && status < 300) {
        clearKeyInFlight(key.id);
        // Update cache instantly (synchronous) + DB sync (awaited) so the
        // "active" status persists even on Vercel serverless.
        markKeyStateInCache(userId, key.id, {
          status: "active",
          cooldownUntil: null,
          lastError: null,
          lastUsedAt: new Date(),
        });
        // ── Reset sibling keys in this provider ──
        // When one key succeeds, clear the cooldown of OTHER keys in the same
        // provider so they get retried on the next request (they may have been
        // put in cooldown by a transient error). This prevents a provider from
        // being "locked out" just because one key had a temporary hiccup.
        resetProviderKeysInCache(userId, provider.id, key.id);
        meta.providerId = provider.id;
        meta.providerKeyId = key.id;
        meta.providerName = provider.name;
        meta.success = true;

        const respHeaders = new Headers(upstream.headers);
        respHeaders.delete("content-encoding");
        respHeaders.delete("content-length");
        respHeaders.delete("transfer-encoding");
        respHeaders.set("x-gateway-provider", provider.name);
        respHeaders.set("x-gateway-retries", String(meta.retried));

        logRequestBackground({
          userId,
          masterApiKeyId: masterKey.id,
          providerId: provider.id,
          providerKeyId: key.id,
          providerName: provider.name,
          model,
          endpointType: detected.type,
          method,
          path,
          statusCode: status,
          durationMs: Date.now() - startedAt,
          requestSize: bodyBuffer?.byteLength ?? 0,
          success: true,
          retried: meta.retried - 1,
        });
        touchMasterKeyBackground(masterKey.id);

        // ── AWAIT the success DB write before returning ──
        // On Vercel serverless, fire-and-forget writes are dropped when the
        // function exits after returning. We MUST await this so the key's
        // "active" status persists to DB — otherwise the dashboard shows the
        // key stuck in its previous bad state (rate_limited/error) forever.
        await markKeySuccessSync(key.id, provider.id);

        // ── Protocol translation: Anthropic response → OpenAI ──
        if (isAnthropicProvider) {
          const isStream = /text\/event-stream/i.test(
            upstream.headers.get("content-type") || ""
          );
          if (isStream) {
            const streamState = { model: model || "unknown", started: false };
            const transformed = translateAnthropicStream(upstream.body, streamState);
            respHeaders.set("content-type", "text/event-stream");
            respHeaders.set("cache-control", "no-cache");
            return new Response(transformed, {
              status,
              statusText: upstream.statusText,
              headers: respHeaders,
            });
          } else {
            const respText = await upstream.text();
            const respJson = safeParseJson(respText);
            const translated = anthropicToOpenAIResponse(respJson);
            return new Response(JSON.stringify(translated), {
              status,
              statusText: upstream.statusText,
              headers: respHeaders,
            });
          }
        }

        // ── Protocol translation: Responses API → Chat Completions ──
        if (isResponsesProvider) {
          const respText = await upstream.text();
          const respJson = safeParseJson(respText);
          const translated = responsesToChatResponse(respJson);
          respHeaders.set("content-type", "application/json");
          return new Response(JSON.stringify(translated), {
            status,
            statusText: upstream.statusText,
            headers: respHeaders,
          });
        }

        return new Response(upstream.body, {
          status,
          statusText: upstream.statusText,
          headers: respHeaders,
        });
      }

      // ── Error — read up to 2KB of body for classification (capped) ──
      const errText = await readCapped(upstream, MAX_ERROR_BODY);
      const verdict = classifyResponse(status, errText);

      // Clear in-flight marker (request finished with this key)
      clearKeyInFlight(key.id);

      // ── "retry" (5xx): DON'T penalize the key at all ──
      // 503/502/504 means the provider was briefly overloaded — the KEY is
      // fine. We just rotate to the next key WITHOUT changing this key's
      // status. It stays 'active' and is immediately reusable. This prevents
      // "all keys exhausted" when the provider has transient 5xx hiccups.
      if (verdict.action === "retry") {
        // Only log the error count (for stats), don't change status/cooldown
        markKeyBackground(userId, key.id, {
          action: "retry",
          reason: verdict.reason,
          statusCode: status,
        });
        // Track that we had 5xx (for the retry-pass logic)
        // (onlyHad5xxErrors stays true)
        continue; // try next key immediately
      } else {
        // Any non-5xx error means we shouldn't do a full retry pass
        onlyHad5xxErrors = false;
      }

      // For all other error actions, fire-and-forget the key health update
      markKeyBackground(userId, key.id, {
        action: verdict.action,
        reason: verdict.reason,
        statusCode: status,
      });

      // ── Quota exhausted: skip to next PROVIDER (not just next key) ──
      if (verdict.action === "quota_exhausted") {
        break; // break out of the key loop → move to next provider
      }

      // If it's a client error that isn't the key's fault, return it to the
      // client immediately (transparent behaviour — don't silently retry).
      if (verdict.action === "ignore") {
        meta.providerId = provider.id;
        meta.providerKeyId = key.id;
        meta.providerName = provider.name;
        logRequestBackground({
          userId,
          masterApiKeyId: masterKey.id,
          providerId: provider.id,
          providerKeyId: key.id,
          providerName: provider.name,
          model,
          endpointType: detected.type,
          method,
          path,
          statusCode: status,
          durationMs: Date.now() - startedAt,
          requestSize: bodyBuffer?.byteLength ?? 0,
          success: false,
          retried: meta.retried - 1,
          error: `client_${status}`,
        });
        touchMasterKeyBackground(masterKey.id);
        return new Response(errText, {
          status,
          statusText: upstream.statusText,
          headers: cleanRespHeaders(upstream.headers),
        });
      }

      // Otherwise rotate to next key / provider immediately (DB writes are
      // already firing in the background — no waiting).
      continue;
    }
  }

  // ── 6. All keys/providers exhausted ───────────────────────────────
  // If we only had 5xx errors AND this was pass 0 or 1, retry.
  // 5xx is transient — the provider may have recovered between passes.
  if (onlyHad5xxErrors && pass < 2 && meta.retried > 0) {
    continue; // do another pass
  }
  break; // no more passes
  } // end for pass
  logRequestBackground({
    userId,
    masterApiKeyId: masterKey.id,
    providerId: meta.providerId,
    providerKeyId: meta.providerKeyId,
    providerName: meta.providerName,
    model,
    endpointType: detected.type,
    method,
    path,
    statusCode: 502,
    durationMs: Date.now() - startedAt,
    requestSize: bodyBuffer?.byteLength ?? 0,
    success: false,
    retried: meta.retried,
    error: "all_keys_exhausted",
  });
  touchMasterKeyBackground(masterKey.id);

  // ── Diagnostic: when NO attempt was made, explain WHY each key was skipped ──
  // Keys with isActive=false are not even loaded into the cache, so without
  // this query the user would never know a key was manually turned off.
  let detail = "";
  if (meta.retried === 0 && candidates.length > 0) {
    try {
      const candIds = candidates.map((c) => c.id);
      const keys = await db.providerApiKey.findMany({
        where: { providerId: { in: candIds } },
        select: {
          keyPreview: true,
          isActive: true,
          status: true,
          lastError: true,
          cooldownUntil: true,
          provider: { select: { name: true } },
        },
      });
      const byProvider = new Map<string, string[]>();
      const nowMs = Date.now();
      for (const k of keys) {
        const pname = k.provider?.name || "provider";
        let state: string;
        if (!k.isActive) state = "turned off";
        else if (k.status === "active") state = "active";
        else if (k.cooldownUntil && k.cooldownUntil.getTime() > nowMs)
          state = `${k.status} (cooldown until ${k.cooldownUntil.toISOString().slice(11, 19)}Z)`;
        else state = k.status;
        const errPart =
          k.lastError && k.status !== "active"
            ? ` — last error: ${String(k.lastError).slice(0, 80)}`
            : "";
        const arr = byProvider.get(pname) ?? [];
        arr.push(`***${k.keyPreview}: ${state}${errPart}`);
        byProvider.set(pname, arr);
      }
      const parts = [...byProvider.entries()].map(
        ([p, ks]) => `Provider '${p}': ${ks.join("; ")}`
      );
      detail = " " + parts.join(" | ").slice(0, 900);
    } catch {
      // diagnostics are best-effort — never mask the original error
    }
  }

  const hint =
    meta.retried === 0
      ? " No key was tried. Open the dashboard → Providers → this provider's keys, and enable/reset a key."
      : "";
  return jsonError(
    502,
    `All provider keys exhausted for ${detected.type}${model ? ` / ${model}` : ""}. ${meta.retried} attempt(s) made.${detail}${hint}`,
    meta
  );
}

// ───────────────────────── helpers ─────────────────────────

/** A key is usable if it's active AND (healthy OR its cooldown has expired). */
function isKeyUsable(k: CachedKey, now: number): boolean {
  if (!k.isActive) return false;
  if (k.status === "active") return true;
  if (k.status === "disabled" || k.status === "exhausted") return false;
  // rate_limited / error → usable if cooldown expired
  if (k.cooldownUntil && k.cooldownUntil.getTime() < now) {
    // Auto-recover: clear the stale cooldown in-memory so the dashboard
    // and subsequent requests see this key as healthy.
    k.status = "active";
    k.cooldownUntil = null;
    return true;
  }
  return false;
}

/** Read at most `maxBytes` from a response body as text. Prevents huge error
 *  pages from stalling classification. */
async function readCapped(res: Response, maxBytes: number): Promise<string> {
  try {
    const reader = res.body?.getReader();
    if (!reader) {
      // No streaming body — fall back to text()
      const t = await res.text();
      return t.length > maxBytes ? t.slice(0, maxBytes) : t;
    }
    const decoder = new TextDecoder();
    let out = "";
    let read = 0;
    while (read < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      out += decoder.decode(value, { stream: true });
      read += value?.byteLength ?? 0;
    }
    return out;
  } catch {
    return "";
  }
}

function jsonError(status: number, message: string, meta: ProxyResult["meta"]): Response {
  return Response.json(
    { error: { message, type: "gateway_error", meta } },
    { status }
  );
}

function cleanRespHeaders(h: Headers): Headers {
  const out = new Headers(h);
  out.delete("content-encoding");
  out.delete("content-length");
  out.delete("transfer-encoding");
  return out;
}

/**
 * Transform an Anthropic SSE stream into an OpenAI-compatible SSE stream.
 */
function translateAnthropicStream(
  body: ReadableStream<Uint8Array> | null,
  state: { model: string; started: boolean }
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  return new ReadableStream({
    async start(controller) {
      if (!body) {
        controller.close();
        return;
      }
      const reader = body.getReader();
      let buffer = "";

      // Lazy import to avoid circular dependency at module load
      const { anthropicStreamToOpenAI } = await import("./translate");

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const parts = buffer.split("\n\n");
          buffer = parts.pop() || "";

          for (const part of parts) {
            const lines = part.split("\n");
            let evt = "";
            let dataStr = "";
            for (const line of lines) {
              if (line.startsWith("event:")) evt = line.slice(6).trim();
              else if (line.startsWith("data:")) dataStr += line.slice(5).trim();
            }
            if (!evt && !dataStr) continue;
            let data: unknown = null;
            if (dataStr) {
              try {
                data = JSON.parse(dataStr);
              } catch {
                data = dataStr;
              }
            }
            const chunk = anthropicStreamToOpenAI(evt, data, state);
            if (chunk) {
              controller.enqueue(encoder.encode(chunk));
            }
          }
        }
      } catch (err) {
        controller.error(err);
        return;
      }
      controller.close();
    },
  });
}

// ───────────────────────── Background DB writers (fire-and-forget) ─────────────────────────
//
// These never throw into the request path. They run as detached promises so
// the proxy loop can rotate keys instantly without waiting for any DB write.
//
// IMPORTANT (Vercel serverless): fire-and-forget writes may be DROPPED if the
// function exits immediately after returning the response. For this reason,
// the SUCCESS path uses markKeySuccessSync() which is AWAITED before the
// response is returned — ensuring the key's "active" state persists to DB.
// Error/cooldown writes stay fire-and-forget (losing them is harmless: the
// cache still has the state, and the next request re-discovers the error).

/**
 * Synchronous (awaited) key-success DB write.
 * MUST be awaited before returning the response on serverless — otherwise
 * Vercel may kill the function and the "active" status never reaches the DB,
 * leaving the key stuck in a bad state in the dashboard.
 *
 * ALSO: recovers sibling keys in the same provider whose cooldown has
 * expired — sets them back to 'active' so the dashboard reflects reality.
 */
async function markKeySuccessSync(keyId: string, providerId: string): Promise<void> {
  const now = new Date();
  try {
    // 1. Mark the succeeded key as active
    await db.providerApiKey.update({
      where: { id: keyId },
      data: {
        status: "active",
        cooldownUntil: null,
        lastError: null,
        lastUsedAt: now,
        lastErrorAt: now,
        totalSuccess: { increment: 1 },
        totalRequests: { increment: 1 },
      },
    });
    // 2. Recover ALL sibling keys in the same provider that are in a transient
    //    bad state (error/rate_limited) — regardless of whether their cooldown
    //    expired. A successful request proves the provider is working, so any
    //    503/timeout on other keys was transient and should be cleared.
    //    Only truly disabled keys (401 unauthorized) stay disabled.
    await db.providerApiKey.updateMany({
      where: {
        providerId,
        isActive: true,
        status: { in: ["rate_limited", "error"] },
      },
      data: { status: "active", cooldownUntil: null, lastError: null },
    });
  } catch {
    // best-effort
  }
}

function markKeyBackground(
  userId: string,
  keyId: string,
  opts: { action: string; reason: string; statusCode?: number }
): void {
  const now = new Date();

  // ── 1. Update the in-memory cache INSTANTLY (synchronous, no await) ──
  // This is what makes rotation rocket-fast: the very next request in the
  // same burst sees the key as disabled/cooldown and skips it without
  // wasting an HTTP call. Without this, a 5s cache window would re-try
  // the dead key on every concurrent request.
  //
  // SPECIAL: "retry" (5xx) does NOT change the key's status or cooldown —
  // the key stays 'active' and is immediately reusable. We only increment
  // the error/request counters for stats.
  const cooldownMs =
    opts.action === "quota_exhausted"
      ? 5 * 60 * 1000 // 5 min — no balance, retry after user tops up
      : opts.action === "cooldown"
      ? 30_000 // 30s — rate limit
      : opts.action === "error"
      ? 3_000 // 3s — transient
      : 0;

  const cacheUpdates: Partial<CachedKey> = {
    lastUsedAt: now,
  };
  switch (opts.action) {
    case "ok":
      cacheUpdates.status = "active";
      cacheUpdates.cooldownUntil = null;
      cacheUpdates.lastError = null;
      break;
    case "retry":
      // DON'T change status, cooldown, or lastError — key is fine!
      // Just update lastUsedAt (already set above).
      break;
    case "disable":
      cacheUpdates.status = "disabled";
      cacheUpdates.lastError = opts.reason;
      cacheUpdates.isActive = false;
      break;
    case "quota_exhausted":
      cacheUpdates.status = "rate_limited"; // status text
      cacheUpdates.cooldownUntil = new Date(now.getTime() + cooldownMs);
      cacheUpdates.lastError = `quota_exhausted: ${opts.reason}`;
      break;
    case "cooldown":
      cacheUpdates.status = "rate_limited";
      cacheUpdates.cooldownUntil = new Date(now.getTime() + cooldownMs);
      cacheUpdates.lastError = opts.reason;
      break;
    case "error":
      cacheUpdates.status = "error";
      cacheUpdates.cooldownUntil = new Date(now.getTime() + cooldownMs);
      cacheUpdates.lastError = opts.reason;
      break;
  }
  markKeyStateInCache(userId, keyId, cacheUpdates);

  // ── 2. Fire the DB write in the background (detached, never blocks) ──
  void (async () => {
    const data: Record<string, unknown> = {
      lastUsedAt: now,
      lastErrorAt: now,
    };

    switch (opts.action) {
      case "ok":
        data.status = "active";
        data.cooldownUntil = null;
        data.totalSuccess = { increment: 1 };
        data.totalRequests = { increment: 1 };
        data.lastError = null;
        break;
      case "retry":
        // 5xx: DON'T change status, cooldown, or lastError.
        // Just count the request + error for stats. Key stays 'active'.
        data.totalErrors = { increment: 1 };
        data.totalRequests = { increment: 1 };
        break;
      case "disable":
        data.status = "disabled";
        data.isActive = false;
        data.totalErrors = { increment: 1 };
        data.totalRequests = { increment: 1 };
        data.lastError = opts.reason;
        break;
      case "quota_exhausted":
        data.status = "rate_limited";
        data.cooldownUntil = new Date(now.getTime() + cooldownMs);
        data.totalErrors = { increment: 1 };
        data.totalRequests = { increment: 1 };
        data.lastError = `quota_exhausted: ${opts.reason}`;
        break;
      case "cooldown":
        data.status = "rate_limited";
        data.cooldownUntil = new Date(now.getTime() + cooldownMs);
        data.totalErrors = { increment: 1 };
        data.totalRequests = { increment: 1 };
        data.lastError = opts.reason;
        break;
      case "error":
        data.status = "error";
        data.totalErrors = { increment: 1 };
        data.totalRequests = { increment: 1 };
        data.lastError = opts.reason;
        data.cooldownUntil = new Date(now.getTime() + cooldownMs);
        break;
      default:
        data.totalRequests = { increment: 1 };
    }

    try {
      await db.providerApiKey.update({ where: { id: keyId }, data });
      await db.keyHealthLog.create({
        data: {
          providerKeyId: keyId,
          event: opts.action,
          statusCode: opts.statusCode ?? null,
          message: opts.reason,
        },
      });
    } catch {
      // best-effort — never break the proxy loop
    }
  })();
}

function touchMasterKeyBackground(id: string): void {
  void (async () => {
    try {
      await db.masterApiKey.update({
        where: { id },
        data: { lastUsedAt: new Date() },
      });
    } catch {
      // best-effort
    }
  })();
}

interface LogRequestOpts {
  userId: string;
  masterApiKeyId: string;
  providerId: string | null;
  providerKeyId: string | null;
  providerName: string | null;
  model: string | null;
  endpointType: EndpointType;
  method: string;
  path: string;
  statusCode: number | null;
  durationMs: number;
  requestSize: number;
  success: boolean;
  retried: number;
  error?: string;
}

function logRequestBackground(opts: LogRequestOpts): void {
  void (async () => {
    try {
      await db.requestLog.create({
        data: {
          userId: opts.userId,
          masterApiKeyId: opts.masterApiKeyId,
          providerId: opts.providerId,
          providerKeyId: opts.providerKeyId,
          providerName: opts.providerName,
          model: opts.model,
          endpointType: opts.endpointType,
          method: opts.method,
          path: opts.path,
          statusCode: opts.statusCode,
          durationMs: opts.durationMs,
          requestSize: opts.requestSize,
          success: opts.success,
          retried: opts.retried,
          error: opts.error ?? null,
        },
      });
    } catch {
      // best-effort
    }
  })();
}
