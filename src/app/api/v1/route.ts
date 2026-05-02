import { NextRequest, NextResponse } from 'next/server';
import { findOne, update } from '@/lib/db';
import { verifyToken, extractBearerToken } from '@/lib/auth';
import {
  getProviderAndKeyForModel,
  getFailoverProviderAndKey,
  getNextKeyFromSameProvider,
  markKeyStatus,
  incrementKeyUsage,
} from '@/lib/key-pool';
import { logUsage, getModelPricing, calculateCost } from '@/lib/usage';
import { v4 as uuidv4 } from 'uuid';

// ============================================
// AI API GATEWAY — Transparent Proxy
// - Passes requests to provider AS-IS
// - Rotates keys on 401/402/403/429/5xx
// - Streams without any modification
// ============================================

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  const requestId = uuidv4();

  try {
    // === Auth ===
    const authHeader = request.headers.get('authorization');
    let userId: string | null = null;
    let apiKeyId: string | null = null;

    if (authHeader) {
      const token = extractBearerToken(authHeader);
      if (token) {
        if (token.startsWith('sk-live-')) {
          const apiKeyRecord = await findOne('api_keys', { key: token, status: 'active' });
          if (apiKeyRecord) {
            userId = apiKeyRecord.user_id;
            apiKeyId = apiKeyRecord.id;
            await update('api_keys', { last_used_at: new Date().toISOString() }, { id: apiKeyId });
          }
        } else {
          const payload = verifyToken(token);
          if (payload) userId = payload.userId;
        }
      }
    }

    if (!userId) {
      return NextResponse.json(
        { error: { message: 'Invalid API key or token', type: 'authentication_error' } },
        { status: 401 }
      );
    }

    const user = await findOne('users', { id: userId });
    if (!user || user.status !== 'active') {
      return NextResponse.json(
        { error: { message: 'Account suspended', type: 'account_error' } },
        { status: 403 }
      );
    }

    const userBalance = parseFloat(user.balance);
    if (userBalance <= 0) {
      return NextResponse.json(
        { error: { message: 'Insufficient balance. Please top up your account.', type: 'insufficient_balance' } },
        { status: 402 }
      );
    }

    // === Parse request body ===
    const body = await request.json();
    const { model: requestedModel } = body;

    if (!requestedModel || !body.messages || !Array.isArray(body.messages)) {
      return NextResponse.json(
        { error: { message: 'model and messages are required', type: 'invalid_request_error' } },
        { status: 400 }
      );
    }

    const modelMapping: Record<string, string> = {
      'deepseek-v3.1': 'deepseek-ai/deepseek-v3.1-terminus',
      'deepseek-v3': 'deepseek-ai/deepseek-v3.1-terminus',
      'gpt-oss-120b': 'openai-gpt-oss-120b',
      'gpt-oss-20b': 'openai-gpt-oss-20b',
    };
    const modelName = modelMapping[requestedModel] || requestedModel;

    const providerKey = await getProviderAndKeyForModel(modelName);
    if (!providerKey) {
      return NextResponse.json(
        { error: { message: `Model '${requestedModel}' not available`, type: 'model_not_found' } },
        { status: 404 }
      );
    }

    const { provider, key: providerKeyInfo } = providerKey;
    const pricing = await getModelPricing(modelName);
    const inputPrice = pricing?.inputPricePer1m || 0;
    const outputPrice = pricing?.outputPricePer1m || 0;

    // === Route: streaming vs non-streaming ===
    if (body.stream) {
      return handleStreamRequest(
        body, provider, providerKeyInfo, modelName,
        userId, apiKeyId, inputPrice, outputPrice, startTime, requestId
      );
    }

    return handleNonStreamRequest(
      body, provider, providerKeyInfo, modelName,
      userId, apiKeyId, inputPrice, outputPrice, startTime, requestId
    );
  } catch (error: any) {
    console.error('[Gateway] Error:', error);
    return NextResponse.json(
      { error: { message: 'Internal gateway error', type: 'gateway_error' } },
      { status: 500 }
    );
  }
}

// ============================================
// BUILD PROVIDER REQUEST
// Transparent: passes client body AS-IS, only overrides model name
// ============================================

function buildProviderRequest(body: any, provider: any, providerKeyInfo: any) {
  const chatPath = provider.chat_path || '/chat/completions';
  const authType = provider.auth_type || 'bearer';
  const url = `${provider.base_url}${chatPath}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (authType === 'api_key') {
    headers['x-api-key'] = providerKeyInfo.key;
  } else {
    headers['Authorization'] = `Bearer ${providerKeyInfo.key}`;
  }

  // Pass client body exactly as-is — don't add/modify/remove anything
  // The client (OpenClaw etc.) knows what params to send
  return { url, headers, body: JSON.stringify(body) };
}

// ============================================
// NON-STREAMING HANDLER
// ============================================

async function handleNonStreamRequest(
  body: any, provider: any, providerKeyInfo: any, modelName: string,
  userId: string, apiKeyId: string | null, inputPrice: number, outputPrice: number,
  startTime: number, requestId: string, attemptCount: number = 0
): Promise<NextResponse> {
  try {
    const { url, headers, body: reqBody } = buildProviderRequest(body, provider, providerKeyInfo);

    console.log(`[Gateway] -> ${provider.name} model=${modelName} attempt=${attemptCount}`);

    const response = await fetchWithTimeout(url, { method: 'POST', headers, body: reqBody }, provider.timeout_ms || 60000);

    if (!response.ok) {
      return handleProviderError(response, provider, providerKeyInfo, body, modelName,
        userId, apiKeyId, inputPrice, outputPrice, startTime, requestId, attemptCount, false);
    }

    const rawData = await response.json();
    const latencyMs = Date.now() - startTime;
    const tokens = extractTokens(rawData, provider);
    const cost = calculateCost(tokens.inputTokens, tokens.outputTokens, inputPrice, outputPrice);

    incrementKeyUsage(providerKeyInfo.id).catch(() => {});
    logUsage({
      userId, apiKeyId: apiKeyId || undefined, model: modelName,
      providerId: provider.id, providerKeyId: providerKeyInfo.id,
      inputTokens: tokens.inputTokens, outputTokens: tokens.outputTokens,
      totalTokens: tokens.totalTokens, cost, latencyMs,
      status: 'success', requestId,
    }).catch(() => {});

    return NextResponse.json(rawData, {
      headers: {
        'X-Request-Id': requestId,
        'X-Provider': provider.name,
      }
    });
  } catch (error: any) {
    console.error('[Gateway] Non-stream error:', error);

    if ((error.name === 'AbortError' || error.message?.includes('timeout')) && attemptCount < 3) {
      return tryFailover(body, provider, providerKeyInfo, modelName,
        userId, apiKeyId, inputPrice, outputPrice, startTime, requestId, attemptCount, 'timeout', false);
    }

    return NextResponse.json(
      { error: { message: 'Gateway request failed', type: 'gateway_error' } },
      { status: 500 }
    );
  }
}

// ============================================
// STREAMING HANDLER — Transparent Proxy
// NO modification of stream data
// NO parameter filtering
// NO token counting during stream
// Just pipe provider response body → client
// ============================================

async function handleStreamRequest(
  body: any, provider: any, providerKeyInfo: any, modelName: string,
  userId: string, apiKeyId: string | null, inputPrice: number, outputPrice: number,
  startTime: number, requestId: string, attemptCount: number = 0
): Promise<Response> {
  try {
    const { url, headers, body: reqBody } = buildProviderRequest(body, provider, providerKeyInfo);

    console.log(`[Stream] -> ${provider.name} model=${modelName} attempt=${attemptCount}`);

    // Simple fetch — NO AbortController, NO race, NO timeout on stream body
    // The stream will flow freely until the provider finishes naturally
    const response = await fetch(url, { method: 'POST', headers, body: reqBody });

    // Handle errors with failover
    if (!response.ok) {
      const result = await handleProviderError(response, provider, providerKeyInfo, body, modelName,
        userId, apiKeyId, inputPrice, outputPrice, startTime, requestId, attemptCount, true);

      // If failover returned a new stream request, return it
      if (result instanceof Response && result.headers.get('Content-Type') === 'text/event-stream') {
        return result;
      }

      // Otherwise it's a JSON error — convert to Response
      return result as unknown as Response;
    }

    if (!response.body) {
      return NextResponse.json(
        { error: { message: 'Provider returned empty stream', type: 'stream_error' } },
        { status: 502 }
      ) as unknown as Response;
    }

    // === TRANSPARENT STREAMING ===
    // Just pipe the provider's response body directly to the client
    // No TransformStream, no analysis, no modification — pure passthrough
    console.log(`[Stream] Connected to ${provider.name}, piping response body`);

    // Fire-and-forget usage logging
    const inputTokens = estimateTokens(JSON.stringify(body.messages));
    const cost = calculateCost(inputTokens, 0, inputPrice, outputPrice);
    incrementKeyUsage(providerKeyInfo.id).catch(() => {});
    logUsage({
      userId, apiKeyId: apiKeyId || undefined, model: modelName,
      providerId: provider.id, providerKeyId: providerKeyInfo.id,
      inputTokens, outputTokens: 0, totalTokens: inputTokens,
      cost, latencyMs: Date.now() - startTime,
      status: 'success', requestId,
    }).catch(() => {});

    return new Response(response.body, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'X-Accel-Buffering': 'no',
        'X-Request-Id': requestId,
        'X-Provider': provider.name,
      },
    });
  } catch (error: any) {
    console.error('[Stream] Error:', error);

    if (attemptCount < 3) {
      return tryFailover(body, provider, providerKeyInfo, modelName,
        userId, apiKeyId, inputPrice, outputPrice, startTime, requestId, attemptCount, error.message, true);
    }

    return NextResponse.json(
      { error: { message: 'Stream failed', type: 'stream_error' } },
      { status: 500 }
    ) as unknown as Response;
  }
}

// ============================================
// ERROR HANDLING WITH FAILOVER
// ============================================

async function handleProviderError(
  response: Response, provider: any, providerKeyInfo: any, body: any, modelName: string,
  userId: string, apiKeyId: string | null, inputPrice: number, outputPrice: number,
  startTime: number, requestId: string, attemptCount: number, isStream: boolean
): Promise<NextResponse | Response> {
  let errorBody = '';
  try { errorBody = await response.text(); } catch {}

  const shouldFailover = [429, 401, 402, 403].includes(response.status) || response.status >= 500;

  if (shouldFailover && attemptCount < 3) {
    // Mark key cooldown based on error type
    if (response.status === 401 || response.status === 402) {
      await markKeyStatus(providerKeyInfo.id, 'rate_limited', 300000); // 5min — key likely dead
    } else if (response.status === 429) {
      await markKeyStatus(providerKeyInfo.id, 'rate_limited', 60000); // 60s
    } else {
      await markKeyStatus(providerKeyInfo.id, 'rate_limited', 30000); // 30s
    }

    return tryFailover(body, provider, providerKeyInfo, modelName,
      userId, apiKeyId, inputPrice, outputPrice, startTime, requestId, attemptCount, `HTTP ${response.status}`, isStream);
  }

  // No failover — return error
  let errorMsg = errorBody;
  try {
    const parsed = JSON.parse(errorBody);
    errorMsg = parsed.error?.message || parsed.message || errorBody;
  } catch {}
  if (!errorMsg) errorMsg = `Provider returned HTTP ${response.status}`;

  console.error(`[Gateway] Provider error [${response.status}]: ${provider.name} - ${errorMsg}`);

  logUsage({
    userId, apiKeyId: apiKeyId || undefined, model: modelName,
    providerId: provider.id, providerKeyId: providerKeyInfo.id,
    inputTokens: 0, outputTokens: 0, totalTokens: 0,
    cost: 0, latencyMs: Date.now() - startTime,
    status: 'error', errorMessage: errorMsg, requestId,
  }).catch(() => {});

  return NextResponse.json(
    { error: { message: errorMsg, type: 'provider_error', provider: provider.name, status: response.status } },
    { status: response.status }
  );
}

// ============================================
// FAILOVER: Same provider key first, then different provider
// ============================================

async function tryFailover(
  body: any, provider: any, providerKeyInfo: any, modelName: string,
  userId: string, apiKeyId: string | null, inputPrice: number, outputPrice: number,
  startTime: number, requestId: string, attemptCount: number, reason: string, isStream: boolean
): Promise<NextResponse | Response> {
  // STEP 1: Try another key from the SAME provider
  const sameProviderKey = await getNextKeyFromSameProvider(provider.id, providerKeyInfo.id);
  if (sameProviderKey) {
    console.log(`[Failover] ${provider.name} failed (${reason}), trying next key from same provider`);
    if (isStream) {
      return handleStreamRequest(body, provider, sameProviderKey, modelName,
        userId, apiKeyId, inputPrice, outputPrice, startTime, requestId, attemptCount + 1);
    }
    return handleNonStreamRequest(body, provider, sameProviderKey, modelName,
      userId, apiKeyId, inputPrice, outputPrice, startTime, requestId, attemptCount + 1);
  }

  // STEP 2: Try a DIFFERENT provider
  const failover = await getFailoverProviderAndKey(provider.id, modelName);
  if (failover) {
    console.log(`[Failover] No more keys in ${provider.name}, switching to ${failover.provider.name}`);
    if (isStream) {
      return handleStreamRequest(body, failover.provider, failover.key, modelName,
        userId, apiKeyId, inputPrice, outputPrice, startTime, requestId, attemptCount + 1);
    }
    return handleNonStreamRequest(body, failover.provider, failover.key, modelName,
      userId, apiKeyId, inputPrice, outputPrice, startTime, requestId, attemptCount + 1);
  }

  // No failover available
  return NextResponse.json(
    { error: { message: `No available provider after ${attemptCount + 1} attempts`, type: 'failover_exhausted' } },
    { status: 503 }
  );
}

// ============================================
// UTILITIES
// ============================================

function extractTokens(data: any, provider: any): { inputTokens: number; outputTokens: number; totalTokens: number } {
  const usage = data.usage || {};
  return {
    inputTokens: usage.prompt_tokens || 0,
    outputTokens: usage.completion_tokens || 0,
    totalTokens: usage.total_tokens || 0,
  };
}

function fetchWithTimeout(url: string, options: any, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timeout));
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
