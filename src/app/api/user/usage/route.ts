import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { verifyToken, extractBearerToken } from '@/lib/auth';

export async function GET(request: NextRequest) {
  try {
    const token = extractBearerToken(request.headers.get('authorization'));
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const payload = verifyToken(token);
    if (!payload) return NextResponse.json({ error: 'Invalid token' }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const days = parseInt(searchParams.get('days') || '30');

    // Get usage logs
    const usageResult = await query('usage_logs', {
      filter: { user_id: payload.userId },
      order: '-created_at',
      limit: 500,
    });

    const logs = usageResult.rows;
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const recentLogs = logs.filter((l: any) => new Date(l.created_at) > cutoff);

    // Summary
    const summary = recentLogs.reduce((acc: any, l: any) => {
      acc.total_tokens += parseInt(l.total_tokens) || 0;
      acc.total_cost += parseFloat(l.cost) || 0;
      acc.total_requests += 1;
      acc.avg_latency = ((acc.avg_latency * (acc.total_requests - 1)) + (parseInt(l.latency_ms) || 0)) / acc.total_requests;
      return acc;
    }, { total_tokens: 0, total_cost: 0, total_requests: 0, avg_latency: 0 });

    // Model breakdown
    const modelMap = new Map<string, any>();
    for (const l of recentLogs) {
      const existing = modelMap.get(l.model) || { model: l.model, requests: 0, tokens: 0, cost: 0 };
      existing.requests += 1;
      existing.tokens += parseInt(l.total_tokens) || 0;
      existing.cost += parseFloat(l.cost) || 0;
      modelMap.set(l.model, existing);
    }

    return NextResponse.json({
      success: true,
      data: {
        summary,
        daily: [],
        modelBreakdown: Array.from(modelMap.values()),
      }
    });
  } catch (error: any) {
    console.error('Usage stats error:', error);
    return NextResponse.json({ error: 'Failed to get usage stats' }, { status: 500 });
  }
}
