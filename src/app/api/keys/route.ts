import { NextRequest, NextResponse } from 'next/server';
import { query, insert, remove } from '@/lib/db';
import { verifyToken, extractBearerToken } from '@/lib/auth';
import { v4 as uuidv4 } from 'uuid';

export async function GET(request: NextRequest) {
  try {
    const token = extractBearerToken(request.headers.get('authorization'));
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const payload = verifyToken(token);
    if (!payload) return NextResponse.json({ error: 'Invalid token' }, { status: 401 });

    const result = await query('api_keys', {
      filter: { user_id: payload.userId },
      order: '-created_at',
    });

    return NextResponse.json({ success: true, data: result.rows });
  } catch (error: any) {
    console.error('Get keys error:', error);
    return NextResponse.json({ error: 'Failed to get API keys' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const token = extractBearerToken(request.headers.get('authorization'));
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const payload = verifyToken(token);
    if (!payload) return NextResponse.json({ error: 'Invalid token' }, { status: 401 });

    const { name } = await request.json();

    // Check key limit
    const countResult = await query('api_keys', { filter: { user_id: payload.userId } });
    if (countResult.rows.length >= 5) {
      return NextResponse.json({ error: 'Maximum 5 API keys allowed' }, { status: 400 });
    }

    const id = uuidv4();
    const key = `sk-live-${uuidv4().replace(/-/g, '')}`;

    await insert('api_keys', {
      id,
      user_id: payload.userId,
      key,
      name: name || 'API Key',
      status: 'active',
    });

    return NextResponse.json({ success: true, data: { id, key, name: name || 'API Key' } }, { status: 201 });
  } catch (error: any) {
    console.error('Create key error:', error);
    return NextResponse.json({ error: 'Failed to create API key' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const token = extractBearerToken(request.headers.get('authorization'));
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const payload = verifyToken(token);
    if (!payload) return NextResponse.json({ error: 'Invalid token' }, { status: 401 });

    const { keyId } = await request.json();

    await remove('api_keys', { id: keyId, user_id: payload.userId });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Delete key error:', error);
    return NextResponse.json({ error: 'Failed to delete API key' }, { status: 500 });
  }
}
