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

    const models = await query('models', {});
    const providers = await query('providers', {});
    const providerMap = new Map(providers.rows.map((p: any) => [p.id, p.name]));

    const enrichedModels = models.rows.map((m: any) => ({
      ...m,
      provider_name: providerMap.get(m.provider_id) || 'Unknown',
    }));

    return NextResponse.json({ success: true, data: enrichedModels });
  } catch (error: any) {
    console.error('Get models error:', error);
    return NextResponse.json({ error: 'Failed to get models' }, { status: 500 });
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

    const { providerId, name, displayName, inputPricePer1m, outputPricePer1m, maxTokens, description } = await request.json();

    if (!providerId || !name || !displayName) {
      return NextResponse.json({ error: 'Provider ID, name, and display name are required' }, { status: 400 });
    }

    const id = uuidv4();
    await insert('models', {
      id,
      provider_id: providerId,
      name,
      display_name: displayName,
      input_price_per_1m: inputPricePer1m || 0,
      output_price_per_1m: outputPricePer1m || 0,
      max_tokens: maxTokens || 4096,
      description: description || null,
      status: 'active',
    });

    return NextResponse.json({ success: true, data: { id } }, { status: 201 });
  } catch (error: any) {
    console.error('Create model error:', error);
    return NextResponse.json({ error: 'Failed to create model: ' + error.message }, { status: 500 });
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

    const { id, displayName, inputPricePer1m, outputPricePer1m, maxTokens, status, description } = await request.json();

    const updateData: any = {};
    if (displayName) updateData.display_name = displayName;
    if (inputPricePer1m !== undefined) updateData.input_price_per_1m = inputPricePer1m;
    if (outputPricePer1m !== undefined) updateData.output_price_per_1m = outputPricePer1m;
    if (maxTokens) updateData.max_tokens = maxTokens;
    if (status) updateData.status = status;
    if (description !== undefined) updateData.description = description;

    await update('models', updateData, { id });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Update model error:', error);
    return NextResponse.json({ error: 'Failed to update model' }, { status: 500 });
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

    if (!id) return NextResponse.json({ error: 'Model ID required' }, { status: 400 });

    await remove('models', { id });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Delete model error:', error);
    return NextResponse.json({ error: 'Failed to delete model' }, { status: 500 });
  }
}
