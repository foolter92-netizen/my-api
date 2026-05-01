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

// Alias: /v1 also handles chat completions (same as /v1/chat/completions)
export async function POST(request: NextRequest) {
  const startTime = Date.now();
  const requestId = uuidv4();

  try {
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

    const providerRequest: any = { model: modelName, messages, stream: !!stream };
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

async function executeWithFailover(
  provider: any, providerKeyInfo: any, providerRequest: any,
  userId: string, apiKeyId: string | null, modelName: string,
  inputPrice: number, outputPrice: number, startTime: number, requestId: string,
  attemptCount: number = 0
): Promise<NextResponse> {
  try {
    const response = await fetchWithTimeout(
      `${provider.base_url}/chat/completions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${providerKeyInfo.key}`,
        },
        body: JSON.stringify(providerRequest),
      },
      provider.timeout_ms || 30000
    );

    // Handle all non-2xx responses
    if (!response.ok) {
      let errorBody = '';
      try { errorBody = await response.text(); } catch {}

      if (response.status === 429) {
        await markKeyStatus(providerKeyInfo.id, 'rate_limited', 60000);
        if (attemptCount < (provider.retry_attempts || 3)) {
          const failover = await getFailoverProviderAndKey(provider.id, modelName);
          if (failover) {
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
          status: 'rate_limited', errorMessage: 'Rate limited', requestId,
        });
        return NextResponse.json(
          { error: { message: 'Rate limited. Please try again later.', type: 'rate_limit_error' } },
          { status: 429 }
        );
      }

      if (response.status >= 500) {
        await markKeyStatus(providerKeyInfo.id, 'rate_limited', 30000);
        if (attemptCount < (provider.retry_attempts || 3)) {
          const failover = await getFailoverProviderAndKey(provider.id, modelName);
          if (failover) {
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

      if (!errorMsg) {
        errorMsg = `Provider returned HTTP ${response.status}`;
      }

      console.error(`Provider error [${response.status}]: ${provider.name} - ${errorMsg}`);

      return NextResponse.json(
        { error: { message: errorMsg, type: 'provider_error', provider: provider.name, status: response.status } },
        { status: response.status }
      );
    }

    const data = await response.json();
    const latencyMs = Date.now() - startTime;
    const inputTokens = data.usage?.prompt_tokens || 0;
    const outputTokens = data.usage?.completion_tokens || 0;
    const totalTokens = data.usage?.total_tokens || 0;
    const cost = calculateCost(inputTokens, outputTokens, inputPrice, outputPrice);

    await incrementKeyUsage(providerKeyInfo.id);
    await logUsage({
      userId, apiKeyId: apiKeyId || undefined, model: modelName,
      providerId: provider.id, providerKeyId: providerKeyInfo.id,
      inputTokens, outputTokens, totalTokens, cost, latencyMs,
      status: 'success', requestId,
    });

    return NextResponse.json(data, {
      headers: {
        'X-Request-Id': requestId,
        'X-Provider': provider.name,
        'X-Tokens-Used': totalTokens.toString(),
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

async function handleStreamRequest(
  provider: any, providerKeyInfo: any, providerRequest: any,
  userId: string, apiKeyId: string | null, modelName: string,
  inputPrice: number, outputPrice: number, startTime: number, requestId: string
): Promise<NextResponse> {
  try {
    const response = await fetchWithTimeout(
      `${provider.base_url}/chat/completions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${providerKeyInfo.key}`,
        },
        body: JSON.stringify({ ...providerRequest, stream: true }),
      },
      provider.timeout_ms || 30000
    );

    if (response.status === 429 || response.status >= 500) {
      await markKeyStatus(providerKeyInfo.id, 'rate_limited', 60000);
      const failover = await getFailoverProviderAndKey(provider.id, modelName);
      if (failover) {
        return handleStreamRequest(
          failover.provider, failover.key, providerRequest,
          userId, apiKeyId, modelName, inputPrice, outputPrice, startTime, requestId
        );
      }
    }

    if (!response.ok) {
      const errorBody = await response.text();
      return NextResponse.json(
        { error: { message: `Provider error: ${errorBody}`, type: 'provider_error' } },
        { status: response.status }
      );
    }

    const latencyMs = Date.now() - startTime;
    await incrementKeyUsage(providerKeyInfo.id);
    const inputTokens = estimateTokens(JSON.stringify(providerRequest.messages));
    const cost = calculateCost(inputTokens, 0, inputPrice, outputPrice);

    await logUsage({
      userId, apiKeyId: apiKeyId || undefined, model: modelName,
      providerId: provider.id, providerKeyId: providerKeyInfo.id,
      inputTokens, outputTokens: 0, totalTokens: inputTokens,
      cost, latencyMs, status: 'success', requestId,
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

function fetchWithTimeout(url: string, options: any, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timeout));
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
