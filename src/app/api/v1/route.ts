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
// OPENAI-COMPATIBLE CHAT COMPLETIONS ENDPOINT
// ============================================

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

// Default max_tokens if client doesn't specify (prevents provider using tiny defaults like 16)
const DEFAULT_MAX_TOKENS = 8192;

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  const requestId = uuidv4();

  try {
    // Authenticate via API key or Bearer token
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

    const body = await request.json();
    const { model: requestedModel, messages, stream, temperature, max_tokens, top_p } = body;

    if (!requestedModel || !messages || !Array.isArray(messages)) {
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

    // Build request body for provider
    // IMPORTANT: Set default max_tokens if not specified by client
    // Some providers default to as low as 16 tokens if not specified!
    const providerRequest: any = {
      model: modelName,
      messages,
      stream: !!stream,
      max_tokens: max_tokens || DEFAULT_MAX_TOKENS,
    };
    if (temperature !== undefined) providerRequest.temperature = temperature;
    if (top_p !== undefined) providerRequest.top_p = top_p;
    // If client explicitly set max_tokens, override the default
    if (max_tokens !== undefined) providerRequest.max_tokens = max_tokens;

    if (stream) {
      return handleStreamRequest(
        provider, providerKeyInfo, providerRequest,
        userId, apiKeyId, modelName, inputPrice, outputPrice, startTime, requestId
      );
    }

    return await executeWithFailover(
      provider, providerKeyInfo, providerRequest,
      userId, apiKeyId, modelName, inputPrice, outputPrice, startTime, requestId
    );
  } catch (error: any) {
    console.error('Gateway error:', error);
    return NextResponse.json(
      { error: { message: 'Internal gateway error', type: 'gateway_error' } },
      { status: 500 }
    );
  }
}

// ============================================
// BUILD PROVIDER-SPECIFIC REQUEST
// ============================================

function buildProviderRequest(provider: any, providerKeyInfo: any, providerRequest: any) {
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

  return { url, headers, body: JSON.stringify(providerRequest) };
}

// ============================================
// TRANSFORM RESPONSE TO OPENAI FORMAT
// ============================================

function transformToOpenAI(data: any, provider: any, modelName: string): any {
  const format = provider.response_format || 'openai';

  if (format === 'openai') return data;

  if (format === 'yepapi') {
    const inner = data.data || data;
    const message = inner.message || {};
    const usage = inner.usage || {};

    return {
      id: inner.id || `chatcmpl-${Date.now()}`,
      object: 'chat.completion',
      created: inner.created || Math.floor(Date.now() / 1000),
      model: inner.model || modelName,
      choices: [
        {
          index: 0,
          message: {
            role: message.role || 'assistant',
            content: message.content || '',
            reasoning: message.reasoning || null,
            refusal: message.refusal || null,
          },
          finish_reason: message.content ? 'stop' : 'abort',
        }
      ],
      usage: {
        prompt_tokens: usage.promptTokens || usage.prompt_tokens || 0,
        completion_tokens: usage.completionTokens || usage.completion_tokens || 0,
        total_tokens: usage.totalTokens || usage.total_tokens || 0,
      },
      system_fingerprint: inner.system_fingerprint || null,
      provider: inner.provider || provider.name,
    };
  }

  return data;
}

// ============================================
// EXTRACT TOKENS FROM ANY FORMAT
// ============================================

function extractTokens(data: any, provider: any): { inputTokens: number; outputTokens: number; totalTokens: number } {
  const format = provider.response_format || 'openai';

  if (format === 'openai') {
    return {
      inputTokens: data.usage?.prompt_tokens || 0,
      outputTokens: data.usage?.completion_tokens || 0,
      totalTokens: data.usage?.total_tokens || 0,
    };
  }

  if (format === 'yepapi') {
    const inner = data.data || data;
    const usage = inner.usage || {};
    return {
      inputTokens: usage.promptTokens || usage.prompt_tokens || 0,
      outputTokens: usage.completionTokens || usage.completion_tokens || 0,
      totalTokens: usage.totalTokens || usage.total_tokens || 0,
    };
  }

  return { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
}

// ============================================
// EXECUTE WITH FAILOVER (Non-Streaming)
// ============================================

async function executeWithFailover(
  provider: any, providerKeyInfo: any, providerRequest: any,
  userId: string, apiKeyId: string | null, modelName: string,
  inputPrice: number, outputPrice: number, startTime: number, requestId: string,
  attemptCount: number = 0
): Promise<NextResponse> {
  try {
    const { url, headers, body } = buildProviderRequest(provider, providerKeyInfo, providerRequest);

    console.log(`[Gateway] -> ${provider.name} ${url} model=${modelName} attempt=${attemptCount}`);

    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers,
      body,
    }, provider.timeout_ms || 30000);

    if (!response.ok) {
      let errorBody = '';
      try { errorBody = await response.text(); } catch {}

      const shouldFailover = [429, 401, 402, 403].includes(response.status) || response.status >= 500;

      if (shouldFailover) {
        if (response.status === 429) {
          await markKeyStatus(providerKeyInfo.id, 'rate_limited', 60000);
        } else if (response.status === 401 || response.status === 402) {
          await markKeyStatus(providerKeyInfo.id, 'rate_limited', 300000);
        } else {
          await markKeyStatus(providerKeyInfo.id, 'rate_limited', 30000);
        }

        if (attemptCount < (provider.retry_attempts || 3)) {
          const sameProviderKey = await getNextKeyFromSameProvider(provider.id, providerKeyInfo.id);
          if (sameProviderKey) {
            console.log(`[Failover] ${provider.name} key failed (${response.status}), trying next key from same provider`);
            return executeWithFailover(
              provider, sameProviderKey, providerRequest,
              userId, apiKeyId, modelName, inputPrice, outputPrice, startTime, requestId, attemptCount + 1
            );
          }

          const failover = await getFailoverProviderAndKey(provider.id, modelName);
          if (failover) {
            console.log(`[Failover] No more keys in ${provider.name}, switching to ${failover.provider.name}`);
            return executeWithFailover(
              failover.provider, failover.key, providerRequest,
              userId, apiKeyId, modelName, inputPrice, outputPrice, startTime, requestId, attemptCount + 1
            );
          }
        }
      }

      let errorMsg = errorBody;
      try {
        const parsed = JSON.parse(errorBody);
        errorMsg = parsed.error?.message || parsed.message || parsed.error?.type || errorBody;
      } catch {}

      if (!errorMsg) errorMsg = `Provider returned HTTP ${response.status}`;

      console.error(`Provider error [${response.status}]: ${provider.name} - ${errorMsg}`);

      await logUsage({
        userId, apiKeyId: apiKeyId || undefined, model: modelName,
        providerId: provider.id, providerKeyId: providerKeyInfo.id,
        inputTokens: 0, outputTokens: 0, totalTokens: 0,
        cost: 0, latencyMs: Date.now() - startTime,
        status: 'error', errorMessage: errorMsg, requestId,
      });

      return NextResponse.json(
        { error: { message: errorMsg, type: 'provider_error', provider: provider.name, status: response.status } },
        { status: response.status }
      );
    }

    const rawData = await response.json();
    const latencyMs = Date.now() - startTime;
    const tokens = extractTokens(rawData, provider);
    const cost = calculateCost(tokens.inputTokens, tokens.outputTokens, inputPrice, outputPrice);

    await incrementKeyUsage(providerKeyInfo.id);

    await logUsage({
      userId,
      apiKeyId: apiKeyId || undefined,
      model: modelName,
      providerId: provider.id,
      providerKeyId: providerKeyInfo.id,
      inputTokens: tokens.inputTokens,
      outputTokens: tokens.outputTokens,
      totalTokens: tokens.totalTokens,
      cost,
      latencyMs,
      status: 'success',
      requestId,
    });

    const openaiData = transformToOpenAI(rawData, provider, modelName);

    return NextResponse.json(openaiData, {
      headers: {
        'X-Request-Id': requestId,
        'X-Provider': provider.name,
        'X-Tokens-Used': tokens.totalTokens.toString(),
        'X-Cost': cost.toFixed(6),
      }
    });
  } catch (error: any) {
    if (error.name === 'AbortError' || error.message?.includes('timeout')) {
      await markKeyStatus(providerKeyInfo.id, 'rate_limited', 30000);

      if (attemptCount < (provider.retry_attempts || 3)) {
        const sameProviderKey = await getNextKeyFromSameProvider(provider.id, providerKeyInfo.id);
        if (sameProviderKey) {
          console.log(`[Failover] ${provider.name} key timed out, trying next key from same provider`);
          return executeWithFailover(
            provider, sameProviderKey, providerRequest,
            userId, apiKeyId, modelName, inputPrice, outputPrice, startTime, requestId, attemptCount + 1
          );
        }

        const failover = await getFailoverProviderAndKey(provider.id, modelName);
        if (failover) {
          console.log(`[Failover] No more keys in ${provider.name} (timeout), switching to ${failover.provider.name}`);
          return executeWithFailover(
            failover.provider, failover.key, providerRequest,
            userId, apiKeyId, modelName, inputPrice, outputPrice, startTime, requestId, attemptCount + 1
          );
        }
      }
    }

    await logUsage({
      userId, apiKeyId: apiKeyId || undefined, model: modelName,
      providerId: provider.id, providerKeyId: providerKeyInfo.id,
      inputTokens: 0, outputTokens: 0, totalTokens: 0,
      cost: 0, latencyMs: Date.now() - startTime,
      status: 'error', errorMessage: error.message, requestId,
    });

    return NextResponse.json(
      { error: { message: 'Gateway request failed', type: 'gateway_error' } },
      { status: 500 }
    );
  }
}

// ============================================
// STREAMING HANDLER
// ============================================
// Key fixes:
// 1. NO AbortController on the stream fetch (prevents signal from killing body)
// 2. Connection timeout via race pattern (disconnects from body stream)
// 3. Default max_tokens prevents tiny provider defaults
// 4. Direct body passthrough with TransformStream for analysis
// ============================================

const MAX_STREAM_ATTEMPTS = 3;
const CONNECTION_TIMEOUT_MS = 120000; // 2 min to first byte

async function handleStreamRequest(
  provider: any, providerKeyInfo: any, providerRequest: any,
  userId: string, apiKeyId: string | null, modelName: string,
  inputPrice: number, outputPrice: number, startTime: number, requestId: string,
  attemptCount: number = 0
): Promise<Response> {
  try {
    const { url, headers, body } = buildProviderRequest(provider, providerKeyInfo, { ...providerRequest, stream: true });

    console.log(`[Stream] -> ${provider.name} ${url} model=${modelName} max_tokens=${providerRequest.max_tokens} attempt=${attemptCount}`);

    // CRITICAL FIX: Use plain fetch WITHOUT AbortController for streaming
    // AbortController signal stays attached to the body stream and can
    // prematurely close it even after headers arrive
    const connectionTimeoutMs = provider.timeout_ms || CONNECTION_TIMEOUT_MS;

    let response: Response;
    try {
      // Race: connection timeout vs actual fetch
      // Once headers arrive, the timeout is irrelevant and the body streams freely
      response = await Promise.race([
        fetch(url, { method: 'POST', headers, body }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Connection timeout')), connectionTimeoutMs)
        ),
      ]);
    } catch (fetchError: any) {
      // Connection failed or timed out — try failover
      console.error(`[Stream] Connection error: ${fetchError.message}`);

      if (attemptCount < MAX_STREAM_ATTEMPTS) {
        await markKeyStatus(providerKeyInfo.id, 'rate_limited', 30000);

        const sameProviderKey = await getNextKeyFromSameProvider(provider.id, providerKeyInfo.id);
        if (sameProviderKey) {
          console.log(`[Stream Failover] ${provider.name} connection failed, trying next key from same provider`);
          return handleStreamRequest(
            provider, sameProviderKey, providerRequest,
            userId, apiKeyId, modelName, inputPrice, outputPrice, startTime, requestId, attemptCount + 1
          );
        }

        const failover = await getFailoverProviderAndKey(provider.id, modelName);
        if (failover) {
          console.log(`[Stream Failover] Switching to ${failover.provider.name}`);
          return handleStreamRequest(
            failover.provider, failover.key, providerRequest,
            userId, apiKeyId, modelName, inputPrice, outputPrice, startTime, requestId, attemptCount + 1
          );
        }
      }

      await logUsage({
        userId, apiKeyId: apiKeyId || undefined, model: modelName,
        providerId: provider.id, providerKeyId: providerKeyInfo.id,
        inputTokens: 0, outputTokens: 0, totalTokens: 0,
        cost: 0, latencyMs: Date.now() - startTime,
        status: 'error', errorMessage: fetchError.message, requestId,
      });

      return NextResponse.json(
        { error: { message: `Stream connection failed: ${fetchError.message}`, type: 'stream_error' } },
        { status: 504 }
      );
    }

    // Handle error HTTP responses with failover
    if (!response.ok) {
      const shouldFailover = [429, 401, 402, 403].includes(response.status) || response.status >= 500;

      if (shouldFailover && attemptCount < MAX_STREAM_ATTEMPTS) {
        if (response.status === 401 || response.status === 402) {
          await markKeyStatus(providerKeyInfo.id, 'rate_limited', 300000);
        } else if (response.status === 429) {
          await markKeyStatus(providerKeyInfo.id, 'rate_limited', 60000);
        } else {
          await markKeyStatus(providerKeyInfo.id, 'rate_limited', 30000);
        }

        const sameProviderKey = await getNextKeyFromSameProvider(provider.id, providerKeyInfo.id);
        if (sameProviderKey) {
          console.log(`[Stream Failover] ${provider.name} key failed (${response.status}), trying next key`);
          return handleStreamRequest(
            provider, sameProviderKey, providerRequest,
            userId, apiKeyId, modelName, inputPrice, outputPrice, startTime, requestId, attemptCount + 1
          );
        }

        const failover = await getFailoverProviderAndKey(provider.id, modelName);
        if (failover) {
          console.log(`[Stream Failover] Switching to ${failover.provider.name}`);
          return handleStreamRequest(
            failover.provider, failover.key, providerRequest,
            userId, apiKeyId, modelName, inputPrice, outputPrice, startTime, requestId, attemptCount + 1
          );
        }
      }

      let errorBody = '';
      try { errorBody = await response.text(); } catch {}

      await logUsage({
        userId, apiKeyId: apiKeyId || undefined, model: modelName,
        providerId: provider.id, providerKeyId: providerKeyInfo.id,
        inputTokens: 0, outputTokens: 0, totalTokens: 0,
        cost: 0, latencyMs: Date.now() - startTime,
        status: 'error', errorMessage: errorBody || `HTTP ${response.status}`, requestId,
      });

      return NextResponse.json(
        { error: { message: errorBody || `Provider returned HTTP ${response.status}`, type: 'provider_error' } },
        { status: response.status }
      );
    }

    if (!response.body) {
      return NextResponse.json(
        { error: { message: 'Provider returned empty stream', type: 'stream_error' } },
        { status: 502 }
      );
    }

    // Calculate input tokens
    const inputTokens = estimateTokens(JSON.stringify(providerRequest.messages));

    // Create the streaming response
    return createStreamingResponse(
      response, provider, providerKeyInfo,
      userId, apiKeyId, modelName,
      inputPrice, outputPrice, inputTokens, startTime, requestId
    );
  } catch (error: any) {
    console.error('[Stream] Unhandled error:', error);

    await logUsage({
      userId, apiKeyId: apiKeyId || undefined, model: modelName,
      providerId: provider.id, providerKeyId: providerKeyInfo.id,
      inputTokens: 0, outputTokens: 0, totalTokens: 0,
      cost: 0, latencyMs: Date.now() - startTime,
      status: 'error', errorMessage: error.message, requestId,
    });

    return NextResponse.json(
      { error: { message: 'Stream failed', type: 'stream_error' } },
      { status: 500 }
    );
  }
}

// ============================================
// ROBUST SSE STREAMING RESPONSE
// Uses TransformStream to decouple from provider fetch
// Passes chunks through IMMEDIATELY, analyzes in parallel
// ============================================

function createStreamingResponse(
  providerResponse: Response,
  provider: any,
  providerKeyInfo: any,
  userId: string,
  apiKeyId: string | null,
  modelName: string,
  inputPrice: number,
  outputPrice: number,
  inputTokens: number,
  startTime: number,
  requestId: string
): Response {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let outputTokenCount = 0;
  let doneReceived = false;
  let streamErrored = false;
  let partialLine = '';
  let chunkCount = 0;

  // Create a TransformStream that passes data through immediately
  // while also analyzing it for token counting and [DONE] detection
  const transform = new TransformStream({
    transform(chunk, controller) {
      // Pass through IMMEDIATELY — no buffering, no waiting
      controller.enqueue(chunk);
      chunkCount++;

      // Also decode for analysis (lightweight, doesn't block passthrough)
      try {
        partialLine += decoder.decode(chunk, { stream: true });
        const lines = partialLine.split('\n');
        partialLine = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed === 'data: [DONE]') {
            doneReceived = true;
            continue;
          }
          const m = trimmed.match(/^data:\s*(.+)$/);
          if (m && m[1] !== '[DONE]') {
            try {
              const parsed = JSON.parse(m[1]);
              const content = parsed.choices?.[0]?.delta?.content || '';
              if (content) outputTokenCount += Math.ceil(content.length / 4);
              if (parsed.usage?.completion_tokens) outputTokenCount = parsed.usage.completion_tokens;
            } catch {}
          }
        }
      } catch {}
    },

    flush(controller) {
      // Stream ended — ensure [DONE] is always sent
      if (!doneReceived) {
        console.log('[Stream] Provider ended without [DONE], appending it');
        try {
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        } catch {}
      }

      console.log(`[Stream] Complete: ${chunkCount} chunks, ~${outputTokenCount} output tokens, DONE=${doneReceived}`);

      // Non-blocking usage logging
      const latencyMs = Date.now() - startTime;
      const cost = calculateCost(inputTokens, outputTokenCount, inputPrice, outputPrice);

      incrementKeyUsage(providerKeyInfo.id).catch(e =>
        console.error('[Stream] Key usage log error:', e?.message)
      );

      logUsage({
        userId,
        apiKeyId: apiKeyId || undefined,
        model: modelName,
        providerId: provider.id,
        providerKeyId: providerKeyInfo.id,
        inputTokens,
        outputTokens: outputTokenCount,
        totalTokens: inputTokens + outputTokenCount,
        cost,
        latencyMs,
        status: streamErrored ? 'error' : 'success',
        requestId,
      }).catch(e =>
        console.error('[Stream] Usage log error:', e?.message)
      );
    },
  });

  // Pipe provider response through our transform
  const processedStream = providerResponse.body!.pipeThrough(transform);

  return new Response(processedStream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
      'X-Request-Id': requestId,
      'X-Provider': provider.name,
    },
  });
}

// ============================================
// UTILITIES
// ============================================

// Only used for non-streaming requests
function fetchWithTimeout(url: string, options: any, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timeout));
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
