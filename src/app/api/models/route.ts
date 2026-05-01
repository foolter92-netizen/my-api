import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

export async function GET() {
  try {
    // Get active models with their provider info
    const modelsResult = await query('models', { filter: { status: 'active' } });
    const providersResult = await query('providers', { filter: { status: 'active' } });

    const providerMap = new Map(providersResult.rows.map((p: any) => [p.id, p]));

    const models = modelsResult.rows
      .filter((m: any) => providerMap.has(m.provider_id))
      .map((m: any) => {
        const provider = providerMap.get(m.provider_id);
        return {
          id: m.name,
          name: m.display_name,
          object: 'model' as const,
          created: Math.floor(Date.now() / 1000),
          owned_by: provider.name,
          pricing: {
            input: parseFloat(m.input_price_per_1k),
            output: parseFloat(m.output_price_per_1k),
          },
          max_tokens: m.max_tokens,
          description: m.description,
        };
      });

    return NextResponse.json({
      object: 'list',
      data: models,
    });
  } catch (error: any) {
    console.error('Get models error:', error);
    return NextResponse.json({ error: 'Failed to get models' }, { status: 500 });
  }
}
