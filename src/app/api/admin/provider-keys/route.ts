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

    const { searchParams } = new URL(request.url);
    const providerId = searchParams.get('providerId');

    let keys;
    if (providerId) {
      keys = await query('provider_keys', { filter: { provider_id: providerId }, order: '-created_at' });
    } else {
      keys = await query('provider_keys', { order: '-created_at' });
    }

    // Enrich with provider names
    const providers = await query('providers', {});
    const providerMap = new Map(providers.rows.map((p: any) => [p.id, p.name]));

    const enrichedKeys = keys.rows.map((k: any) => ({
      ...k,
      provider_name: providerMap.get(k.provider_id) || 'Unknown',
    }));

    return NextResponse.json({ success: true, data: enrichedKeys });
  } catch (error: any) {
    console.error('Get provider keys error:', error);
    return NextResponse.json({ error: 'Failed to get provider keys' }, { status: 500 });
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

    const { providerId, key, name, weight } = await request.json();

    if (!providerId || !key) {
      return NextResponse.json({ error: 'Provider ID and key are required' }, { status: 400 });
    }

    const id = uuidv4();
    await insert('provider_keys', {
      id,
      provider_id: providerId,
      key,
      name: name || 'API Key',
      weight: weight || 1,
      status: 'active',
      usage_count: 0,
      daily_usage_count: 0,
    });

    return NextResponse.json({ success: true, data: { id } }, { status: 201 });
  } catch (error: any) {
    console.error('Create provider key error:', error);
    return NextResponse.json({ error: 'Failed to create provider key' }, { status: 500 });
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

    const { id, status, name, weight } = await request.json();

    const updateData: any = { updated_at: new Date().toISOString() };
    if (status) updateData.status = status;
    if (name) updateData.name = name;
    if (weight) updateData.weight = weight;

    await update('provider_keys', updateData, { id });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Update provider key error:', error);
    return NextResponse.json({ error: 'Failed to update provider key' }, { status: 500 });
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

    if (!id) return NextResponse.json({ error: 'Key ID required' }, { status: 400 });

    await remove('provider_keys', { id });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Delete provider key error:', error);
    return NextResponse.json({ error: 'Failed to delete provider key' }, { status: 500 });
  }
}
