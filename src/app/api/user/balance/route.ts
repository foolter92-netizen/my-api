import { NextRequest, NextResponse } from 'next/server';
import { findOne, query, insert, update } from '@/lib/db';
import { verifyToken, extractBearerToken } from '@/lib/auth';
import { v4 as uuidv4 } from 'uuid';

export async function GET(request: NextRequest) {
  try {
    const token = extractBearerToken(request.headers.get('authorization'));
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const payload = verifyToken(token);
    if (!payload) return NextResponse.json({ error: 'Invalid token' }, { status: 401 });

    const user = await findOne('users', { id: payload.userId });
    const transactions = await query('billing_transactions', {
      filter: { user_id: payload.userId },
      order: '-created_at',
      limit: 50,
    });

    return NextResponse.json({
      success: true,
      data: {
        balance: parseFloat(user?.balance || '0'),
        transactions: transactions.rows,
      }
    });
  } catch (error: any) {
    console.error('Balance error:', error);
    return NextResponse.json({ error: 'Failed to get balance' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const token = extractBearerToken(request.headers.get('authorization'));
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const payload = verifyToken(token);
    if (!payload) return NextResponse.json({ error: 'Invalid token' }, { status: 401 });

    const { amount } = await request.json();
    if (!amount || amount <= 0) {
      return NextResponse.json({ error: 'Invalid amount' }, { status: 400 });
    }

    // Update balance
    const user = await findOne('users', { id: payload.userId });
    const newBalance = parseFloat(user?.balance || '0') + amount;

    await update('users', { balance: newBalance }, { id: payload.userId });

    // Log transaction
    await insert('billing_transactions', {
      id: uuidv4(),
      user_id: payload.userId,
      amount: amount,
      type: 'topup',
      description: 'Account top-up',
    });

    return NextResponse.json({
      success: true,
      data: { balance: newBalance }
    });
  } catch (error: any) {
    console.error('Topup error:', error);
    return NextResponse.json({ error: 'Top-up failed' }, { status: 500 });
  }
}
