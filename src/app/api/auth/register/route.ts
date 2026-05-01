import { NextRequest, NextResponse } from 'next/server';
import { findOne, insert } from '@/lib/db';
import { hashPassword, signToken } from '@/lib/auth';
import { v4 as uuidv4 } from 'uuid';

export async function POST(request: NextRequest) {
  try {
    const { email, password, name } = await request.json();

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password are required' }, { status: 400 });
    }

    if (password.length < 6) {
      return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 });
    }

    // Check if user exists
    const existing = await findOne('users', { email: email.toLowerCase() });
    if (existing) {
      return NextResponse.json({ error: 'Email already registered' }, { status: 409 });
    }

    const userId = uuidv4();
    const passwordHash = await hashPassword(password);

    // Registration bonus
    const bonusSetting = await findOne('system_settings', { key: 'registration_bonus' });
    const bonus = parseFloat(bonusSetting?.value || '1');

    // Create user
    await insert('users', {
      id: userId,
      email: email.toLowerCase(),
      name: name || email.split('@')[0],
      password_hash: passwordHash,
      role: 'user',
      balance: bonus,
      status: 'active',
    });

    // Log bonus
    if (bonus > 0) {
      await insert('billing_transactions', {
        id: uuidv4(),
        user_id: userId,
        amount: bonus,
        type: 'bonus',
        description: 'Registration bonus',
      });
    }

    // Create default API key
    const apiKey = `sk-live-${uuidv4().replace(/-/g, '')}`;
    await insert('api_keys', {
      id: uuidv4(),
      user_id: userId,
      key: apiKey,
      name: 'Default Key',
      status: 'active',
    });

    // Generate token
    const token = signToken({ userId, email: email.toLowerCase(), role: 'user' });

    return NextResponse.json({
      success: true,
      data: {
        user: { id: userId, email: email.toLowerCase(), name: name || email.split('@')[0], role: 'user', balance: bonus },
        apiKey,
        token,
      }
    }, { status: 201 });
  } catch (error: any) {
    console.error('Register error:', error);
    return NextResponse.json({ error: 'Registration failed: ' + error.message }, { status: 500 });
  }
}
