import { NextRequest, NextResponse } from 'next/server';
import { query, insert, update, remove } from '@/lib/db';
import { verifyToken, extractBearerToken } from '@/lib/auth';
import { v4 as uuidv4 } from 'uuid';

export async function GET(request: NextRequest) {
  try {
    const token = extractBearerToken(request.headers.get('authorization'));
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const payload = verifyToken(token);
    if (!payload || payload.role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const providers = await query('providers', { order: 'priority' });
    const allKeys = await query('provider_keys', {});
    const allModels = await query('models', {});

    const enrichedProviders = providers.rows.map((p: any) => ({
      ...p,
      key_count: allKeys.rows.filter((k: any) => k.provider_id === p.id).length,
      model_count: allModels.rows.filter((m: any) => m.provider_id === p.id).length,
    }));

    return NextResponse.json({ success: true, data: enrichedProviders });
  } catch (error: any) {
    console.error('Get providers error:', error);
    return NextResponse.json({ error: 'Failed to get providers' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const token = extractBearerToken(request.headers.get('authorization'));
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const payload = verifyToken(token);
    if (!payload || payload.role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { name, baseUrl, priority, loadBalance, failoverEnabled, timeoutMs, retryAttempts, chatPath, authType, responseFormat } = await request.json();

    if (!name || !baseUrl) {
      return NextResponse.json({ error: 'Name and base URL are required' }, { status: 400 });
    }

    const id = uuidv4();
    await insert('providers', {
      id,
      name,
      base_url: baseUrl,
      priority: priority || 1,
      load_balance: loadBalance || 'round_robin',
      failover_enabled: failoverEnabled !== false,
      timeout_ms: timeoutMs || 30000,
      retry_attempts: retryAttempts || 3,
      status: 'active',
      chat_path: chatPath || '/chat/completions',
      auth_type: authType || 'bearer',
      response_format: responseFormat || 'openai',
    });

    return NextResponse.json({ success: true, data: { id } }, { status: 201 });
  } catch (error: any) {
    console.error('Create provider error:', error);
    return NextResponse.json({ error: 'Failed to create provider: ' + error.message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const token = extractBearerToken(request.headers.get('authorization'));
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const payload = verifyToken(token);
    if (!payload || payload.role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { id, name, baseUrl, status, priority, loadBalance, failoverEnabled, timeoutMs, retryAttempts, chatPath, authType, responseFormat } = await request.json();

    const updateData: any = { updated_at: new Date().toISOString() };
    if (name) updateData.name = name;
    if (baseUrl) updateData.base_url = baseUrl;
    if (status) updateData.status = status;
    if (priority) updateData.priority = priority;
    if (loadBalance) updateData.load_balance = loadBalance;
    if (failoverEnabled !== undefined) updateData.failover_enabled = failoverEnabled;
    if (timeoutMs) updateData.timeout_ms = timeoutMs;
    if (retryAttempts) updateData.retry_attempts = retryAttempts;
    if (chatPath !== undefined) updateData.chat_path = chatPath;
    if (authType !== undefined) updateData.auth_type = authType;
    if (responseFormat !== undefined) updateData.response_format = responseFormat;

    await update('providers', updateData, { id });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Update provider error:', error);
    return NextResponse.json({ error: 'Failed to update provider' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const token = extractBearerToken(request.headers.get('authorization'));
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const payload = verifyToken(token);
    if (!payload || payload.role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) return NextResponse.json({ error: 'Provider ID required' }, { status: 400 });

    await remove('providers', { id });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Delete provider error:', error);
    return NextResponse.json({ error: 'Failed to delete provider' }, { status: 500 });
  }
}
