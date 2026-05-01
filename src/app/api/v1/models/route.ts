import { NextRequest, NextResponse } from 'next/server';
import { query, findOne } from '@/lib/db';
import { verifyToken, extractBearerToken } from '@/lib/auth';

// OpenAI-compatible /v1/models endpoint
export async function GET(request: NextRequest) {
  try {
    // Support both API key and JWT auth
    const authHeader = request.headers.get('authorization');
    let authorized = false;

    if (authHeader) {
      const token = extractBearerToken(authHeader);
      if (token) {
        if (token.startsWith('sk-live-')) {
          const apiKeyRecord = await findOne('api_keys', { key: token, status: 'active' });
          if (apiKeyRecord) authorized = true;
        } else {
          const payload = verifyToken(token);
          if (payload) authorized = true;
        }
      }
    }

    // Allow unauthenticated access to model list for discovery
    // But still support auth for consistency

    const modelsResult = await query('models', { filter: { status: 'active' } });
    const providersResult = await query('providers', { filter: { status: 'active' } });

    const providerMap = new Map(providersResult.rows.map((p: any) => [p.id, p]));

    const models = modelsResult.rows
      .filter((m: any) => providerMap.has(m.provider_id))
      .map((m: any) => ({
        id: m.name,
        object: 'model' as const,
        created: Math.floor(new Date(m.created_at || Date.now()).getTime() / 1000),
        owned_by: providerMap.get(m.provider_id)?.name || 'unknown',
        permission: [],
        root: m.name,
        parent: null,
      }));

    return NextResponse.json({
      object: 'list',
      data: models,
    });
  } catch (error: any) {
    console.error('Get models error:', error);
    return NextResponse.json(
      { error: { message: 'Failed to get models', type: 'api_error' } },
      { status: 500 }
    );
  }
}
