import { query, insert, update, findOne } from './db';
import { v4 as uuidv4 } from 'uuid';

// ============================================
// USAGE & BILLING SYSTEM (Supabase)
// ============================================

export interface UsageRecord {
  userId: string;
  apiKeyId?: string;
  model: string;
  providerId?: string;
  providerKeyId?: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cost: number;
  latencyMs: number;
  status: string;
  errorMessage?: string;
  requestId?: string;
}

export async function logUsage(record: UsageRecord): Promise<string> {
  const id = uuidv4();

  await insert('usage_logs', {
    id,
    user_id: record.userId,
    api_key_id: record.apiKeyId || null,
    model: record.model,
    provider_id: record.providerId || null,
    provider_key_id: record.providerKeyId || null,
    input_tokens: record.inputTokens,
    output_tokens: record.outputTokens,
    total_tokens: record.totalTokens,
    cost: record.cost,
    latency_ms: record.latencyMs,
    status: record.status,
    error_message: record.errorMessage || null,
    request_id: record.requestId || null,
  });

  // Deduct from user balance
  if (record.cost > 0 && record.status === 'success') {
    const user = await findOne('users', { id: record.userId });
    if (user) {
      const newBalance = parseFloat(user.balance) - record.cost;
      await update('users', { balance: newBalance, updated_at: new Date().toISOString() }, { id: record.userId });
    }

    await insert('billing_transactions', {
      id: uuidv4(),
      user_id: record.userId,
      amount: -record.cost,
      type: 'usage',
      description: `Usage: ${record.model} - ${record.totalTokens} tokens`,
      usage_log_id: id,
    });
  }

  return id;
}

export async function getModelPricing(modelName: string): Promise<{
  inputPricePer1k: number;
  outputPricePer1k: number;
} | null> {
  const model = await findOne('models', { name: modelName, status: 'active' });
  if (!model) return null;
  return {
    inputPricePer1k: parseFloat(model.input_price_per_1k),
    outputPricePer1k: parseFloat(model.output_price_per_1k),
  };
}

export function calculateCost(
  inputTokens: number,
  outputTokens: number,
  inputPricePer1k: number,
  outputPricePer1k: number
): number {
  return (inputTokens / 1000) * inputPricePer1k + (outputTokens / 1000) * outputPricePer1k;
}

export async function checkUserBalance(userId: string): Promise<number> {
  const user = await findOne('users', { id: userId });
  if (!user) return 0;
  return parseFloat(user.balance);
}
