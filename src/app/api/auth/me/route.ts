import { NextRequest, NextResponse } from 'next/server';
import { findOne, query } from '@/lib/db';
import { verifyToken, extractBearerToken } from '@/lib/auth';

export async function GET(request: NextRequest) {
  try {
    const token = extractBearerToken(request.headers.get('authorization'));
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = verifyToken(token);
    if (!payload) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    const user = await findOne('users', { id: payload.userId });
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Get API keys
    const keysResult = await query('api_keys', { filter: { user_id: user.id } });

    return NextResponse.json({
      success: true,
      data: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        balance: parseFloat(user.balance),
        status: user.status,
        created_at: user.created_at,
        apiKeys: keysResult.rows,
      }
    });
  } catch (error: any) {
    console.error('Me error:', error);
    return NextResponse.json({ error: 'Failed to get user info' }, { status: 500 });
  }
}
