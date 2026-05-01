import { NextRequest, NextResponse } from 'next/server';
import { query, update } from '@/lib/db';
import { verifyToken, extractBearerToken } from '@/lib/auth';

export async function GET(request: NextRequest) {
  try {
    const token = extractBearerToken(request.headers.get('authorization'));
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const payload = verifyToken(token);
    if (!payload || payload.role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const users = await query('users', { order: '-created_at' });

    // Enrich with key counts and usage
    const allKeys = await query('api_keys', {});
    const allUsage = await query('usage_logs', {});

    const enrichedUsers = users.rows.map((u: any) => ({
      ...u,
      key_count: allKeys.rows.filter((k: any) => k.user_id === u.id).length,
      total_usage: allUsage.rows
        .filter((l: any) => l.user_id === u.id)
        .reduce((sum: number, l: any) => sum + parseFloat(l.cost || 0), 0),
    }));

    return NextResponse.json({ success: true, data: enrichedUsers });
  } catch (error: any) {
    console.error('Get users error:', error);
    return NextResponse.json({ error: 'Failed to get users' }, { status: 500 });
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

    const { id, status, balance, role } = await request.json();

    const updateData: any = { updated_at: new Date().toISOString() };
    if (status) updateData.status = status;
    if (balance !== undefined) updateData.balance = balance;
    if (role) updateData.role = role;

    await update('users', updateData, { id });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Update user error:', error);
    return NextResponse.json({ error: 'Failed to update user' }, { status: 500 });
  }
}
