import { NextRequest, NextResponse } from 'next/server';
import { findOne, update } from '@/lib/db';
import { verifyToken, extractBearerToken } from '@/lib/auth';
import {
  getProviderAndKeyForModel,
  getFailoverProviderAndKey,
  markKeyStatus,
  incrementKeyUsage,
} from '@/lib/key-pool';
import { logUsage, getModelPricing, calculateCost } from '@/lib/usage';
import { v4 as uuidv4 } from 'uuid';

// ============================================
// OPENAI-COMPATIBLE CHAT COMPLETIONS ENDPOINT
// Supports multiple provider formats:
//   - OpenAI format (bearer auth, /chat/completions)
//   - YepAPI format (x-api-key auth, /ai/chat)
// ============================================

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
    const inputPrice = pricing?.inputPricePer1k || 0;
    const outputPrice = pricing?.outputPricePer1k || 0;

    // Build request body for provider
    const providerRequest: any = {
      model: modelName,
      messages,
      stream: !!stream,
    };
    if (temperature !== undefined) providerRequest.temperature = temperature;
    if (max_tokens !== undefined) providerRequest.max_tokens = max_tokens;
    if (top_p !== undefined) providerRequest.top_p = top_p;

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

  // Already OpenAI format
  if (format === 'openai') return data;

  // YepAPI format: { data: { message, usage, model, ... }, ok: true }
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
// EXECUTE WITH FAILOVER
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

    // Handle all non-2xx responses
    if (!response.ok) {
      let errorBody = '';
      try { errorBody = await response.text(); } catch {}

      // Determine if this error should trigger failover
      // 429 = rate limit, 401 = auth/key expired, 402 = quota/balance exhausted,
      // 403 = forbidden, 5xx = server error — all should try failover
      const shouldFailover = [429, 401, 402, 403].includes(response.status) || response.status >= 500;

      if (shouldFailover) {
        // Mark key with cooldown based on error type
        if (response.status === 429) {
          await markKeyStatus(providerKeyInfo.id, 'rate_limited', 60000); // 60s cooldown
        } else if (response.status === 401 || response.status === 402) {
          await markKeyStatus(providerKeyInfo.id, 'rate_limited', 300000); // 5min — key likely dead
        } else {
          await markKeyStatus(providerKeyInfo.id, 'rate_limited', 30000); // 30s cooldown
        }

        if (attemptCount < (provider.retry_attempts || 3)) {
          const failover = await getFailoverProviderAndKey(provider.id, modelName);
          if (failover) {
            console.log(`[Failover] ${provider.name} returned ${response.status}, switching to ${failover.provider.name}`);
            return executeWithFailover(
              failover.provider, failover.key, providerRequest,
              userId, apiKeyId, modelName, inputPrice, outputPrice, startTime, requestId, attemptCount + 1
            );
          }
        }
      }

      // No failover available or max attempts reached — return error to user
      // Parse error for better message
      let errorMsg = errorBody;
      try {
        const parsed = JSON.parse(errorBody);
        errorMsg = parsed.error?.message || parsed.message || parsed.error?.type || errorBody;
      } catch {}

      if (!errorMsg) {
        errorMsg = `Provider returned HTTP ${response.status}`;
      }

      console.error(`Provider error [${response.status}]: ${provider.name} - ${errorMsg}`);

      // Log the failed request
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

    // Extract tokens from provider-specific format
    const tokens = extractTokens(rawData, provider);

    const cost = calculateCost(tokens.inputTokens, tokens.outputTokens, inputPrice, outputPrice);

    // Update key usage
    await incrementKeyUsage(providerKeyInfo.id);

    // Log usage
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

    // Transform response to OpenAI format for the user
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

      const failover = await getFailoverProviderAndKey(provider.id, modelName);
      if (failover && attemptCount < (provider.retry_attempts || 3)) {
        return executeWithFailover(
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

async function handleStreamRequest(
  provider: any, providerKeyInfo: any, providerRequest: any,
  userId: string, apiKeyId: string | null, modelName: string,
  inputPrice: number, outputPrice: number, startTime: number, requestId: string
): Promise<NextResponse> {
  try {
    const { url, headers, body } = buildProviderRequest(provider, providerKeyInfo, { ...providerRequest, stream: true });

    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers,
      body,
    }, provider.timeout_ms || 30000);

    // Determine if this error should trigger failover (same logic as non-streaming)
    const shouldFailover = [429, 401, 402, 403].includes(response.status) || response.status >= 500;

    if (shouldFailover && !response.ok) {
      // Mark key with cooldown based on error type
      if (response.status === 401 || response.status === 402) {
        await markKeyStatus(providerKeyInfo.id, 'rate_limited', 300000); // 5min — key likely dead
      } else {
        await markKeyStatus(providerKeyInfo.id, 'rate_limited', 60000);
      }

      const failover = await getFailoverProviderAndKey(provider.id, modelName);
      if (failover) {
        console.log(`[Stream Failover] ${provider.name} returned ${response.status}, switching to ${failover.provider.name}`);
        return handleStreamRequest(
          failover.provider, failover.key, providerRequest,
          userId, apiKeyId, modelName, inputPrice, outputPrice, startTime, requestId
        );
      }
    }

    if (!response.ok) {
      let errorBody = '';
      try { errorBody = await response.text(); } catch {}
      return NextResponse.json(
        { error: { message: errorBody || `Provider returned HTTP ${response.status}`, type: 'provider_error' } },
        { status: response.status }
      );
    }

    const latencyMs = Date.now() - startTime;
    await incrementKeyUsage(providerKeyInfo.id);

    const inputTokens = estimateTokens(JSON.stringify(providerRequest.messages));
    const cost = calculateCost(inputTokens, 0, inputPrice, outputPrice);

    await logUsage({
      userId,
      apiKeyId: apiKeyId || undefined,
      model: modelName,
      providerId: provider.id,
      providerKeyId: providerKeyInfo.id,
      inputTokens,
      outputTokens: 0,
      totalTokens: inputTokens,
      cost,
      latencyMs,
      status: 'success',
      requestId,
    });

    return new Response(response.body, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Request-Id': requestId,
        'X-Provider': provider.name,
      },
    });
  } catch (error: any) {
    console.error('Stream error:', error);
    return NextResponse.json(
      { error: { message: 'Stream failed', type: 'stream_error' } },
      { status: 500 }
    );
  }
}

// ============================================
// UTILITIES
// ============================================

function fetchWithTimeout(url: string, options: any, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timeout));
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
