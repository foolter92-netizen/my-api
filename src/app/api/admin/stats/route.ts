import { NextRequest, NextResponse } from 'next/server';
import { query, findOne } from '@/lib/db';
import { verifyToken, extractBearerToken } from '@/lib/auth';

export async function GET(request: NextRequest) {
  try {
    const token = extractBearerToken(request.headers.get('authorization'));
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const payload = verifyToken(token);
    if (!payload || payload.role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const users = await query('users', {});
    const providers = await query('providers', { filter: { status: 'active' } });
    const usageLogs = await query('usage_logs', { limit: 1000 });
    const billingLogs = await query('billing_transactions', { filter: { type: 'usage' }, limit: 1000 });

    const totalRevenue = billingLogs.rows.reduce((sum: number, t: any) => sum + Math.abs(parseFloat(t.amount || 0)), 0);
    const totalBalance = users.rows.reduce((sum: number, u: any) => sum + parseFloat(u.balance || 0), 0);

    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const dailyLogs = usageLogs.rows.filter((l: any) => new Date(l.created_at).getTime() > now - dayMs);
    const dailyRequests = dailyLogs.length;
    const dailyTokens = dailyLogs.reduce((sum: number, l: any) => sum + parseInt(l.total_tokens || 0), 0);
    const dailyCost = dailyLogs.reduce((sum: number, l: any) => sum + parseFloat(l.cost || 0), 0);

    return NextResponse.json({
      success: true,
      data: {
        totalUsers: users.rows.length,
        totalBalance,
        dailyRequests,
        dailyTokens,
        dailyCost,
        totalRevenue,
        activeProviders: providers.rows.length,
      }
    });
  } catch (error: any) {
    console.error('Admin stats error:', error);
    return NextResponse.json({ error: 'Failed to get stats' }, { status: 500 });
  }
}
