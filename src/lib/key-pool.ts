import { query, update } from './db';

// ============================================
// KEY POOL MANAGEMENT SYSTEM (Supabase)
// ============================================

export interface ProviderKeyInfo {
  id: string;
  provider_id: string;
  key: string;
  name: string;
  status: string;
  usage_count: number;
  daily_usage_count: number;
  last_used_at: string | null;
  rate_limit_reset_at: string | null;
  cooldown_until: string | null;
  weight: number;
}

export interface ProviderInfo {
  id: string;
  name: string;
  base_url: string;
  status: string;
  priority: number;
  load_balance: string;
  failover_enabled: boolean;
  timeout_ms: number;
  retry_attempts: number;
  chat_path: string;        // e.g. '/chat/completions' or '/ai/chat'
  auth_type: string;        // 'bearer' or 'api_key'
  response_format: string;  // 'openai' or 'yepapi'
}

// In-memory cache for high performance
let keyPoolCache: Map<string, ProviderKeyInfo[]> = new Map();
let providerCache: ProviderInfo[] = [];
let lastCacheRefresh = 0;
const CACHE_TTL = 10000; // 10 seconds

export async function refreshCache() {
  const now = Date.now();
  if (now - lastCacheRefresh < CACHE_TTL) return;

  try {
    // Load providers
    const providersResult = await query('providers', { filter: { status: 'active' } });
    providerCache = providersResult.rows.sort((a: any, b: any) => a.priority - b.priority);

    // Load ALL keys (active + rate_limited) — we'll filter by cooldown below
    // This fixes the bug where rate_limited keys never recover to active
    const activeKeysResult = await query('provider_keys', { filter: { status: 'active' } });
    const rateLimitedKeysResult = await query('provider_keys', { filter: { status: 'rate_limited' } });
    const allKeys = [...activeKeysResult.rows, ...rateLimitedKeysResult.rows];

    // Auto-recover keys whose cooldown has expired
    for (const key of rateLimitedKeysResult.rows) {
      const cooldownExpired = !key.cooldown_until || new Date(key.cooldown_until) <= new Date();
      const rateLimitExpired = !key.rate_limit_reset_at || new Date(key.rate_limit_reset_at) <= new Date();
      if (cooldownExpired && rateLimitExpired) {
        // Reset key back to active status
        await update('provider_keys', { status: 'active' }, { id: key.id });
        key.status = 'active';
      }
    }

    const newKeyPool = new Map<string, ProviderKeyInfo[]>();
    for (const provider of providerCache) {
      const providerKeys = allKeys
        .filter((k: any) => {
          if (k.provider_id !== provider.id) return false;
          if (k.status !== 'active') return false; // Still in cooldown
          // Double-check cooldown hasn't expired
          if (k.cooldown_until && new Date(k.cooldown_until) > new Date()) return false;
          if (k.rate_limit_reset_at && new Date(k.rate_limit_reset_at) > new Date()) return false;
          return true;
        })
        .sort((a: any, b: any) => a.daily_usage_count - b.daily_usage_count);

      newKeyPool.set(provider.id, providerKeys);
    }

    keyPoolCache = newKeyPool;
    lastCacheRefresh = now;
  } catch (error) {
    console.error('Cache refresh error:', error);
  }
}

// ============================================
// LOAD BALANCING ALGORITHMS
// ============================================

let roundRobinIndex: Map<string, number> = new Map();

export function selectKeyRoundRobin(keys: ProviderKeyInfo[], providerId: string): ProviderKeyInfo {
  const idx = (roundRobinIndex.get(providerId) || 0) % keys.length;
  roundRobinIndex.set(providerId, idx + 1);
  return keys[idx];
}

export function selectKeyLeastUsed(keys: ProviderKeyInfo[]): ProviderKeyInfo {
  return keys.reduce((min, key) => key.daily_usage_count < min.daily_usage_count ? key : min, keys[0]);
}

export function selectKeyRandomWeighted(keys: ProviderKeyInfo[]): ProviderKeyInfo {
  const totalWeight = keys.reduce((sum, k) => sum + k.weight, 0);
  let random = Math.random() * totalWeight;
  for (const key of keys) {
    random -= key.weight;
    if (random <= 0) return key;
  }
  return keys[0];
}

export function selectKey(keys: ProviderKeyInfo[], algorithm: string, providerId: string): ProviderKeyInfo {
  switch (algorithm) {
    case 'least_used': return selectKeyLeastUsed(keys);
    case 'random_weighted': return selectKeyRandomWeighted(keys);
    case 'round_robin':
    default: return selectKeyRoundRobin(keys, providerId);
  }
}

// ============================================
// GET PROVIDER & KEY FOR MODEL
// ============================================

export async function getProviderAndKeyForModel(modelName: string): Promise<{
  provider: ProviderInfo;
  key: ProviderKeyInfo;
} | null> {
  await refreshCache();

  // Find model
  const modelsResult = await query('models', { filter: { name: modelName, status: 'active' } });

  if (modelsResult.rows.length === 0) {
    // Try any active provider
    for (const provider of providerCache) {
      const keys = keyPoolCache.get(provider.id) || [];
      if (keys.length > 0) {
        const key = selectKey(keys, provider.load_balance, provider.id);
        return { provider, key };
      }
    }
    return null;
  }

  const modelRow = modelsResult.rows[0];
  const provider = providerCache.find(p => p.id === modelRow.provider_id);

  if (!provider) return null;

  const keys = keyPoolCache.get(provider.id) || [];
  if (keys.length === 0) return null;

  const key = selectKey(keys, provider.load_balance, provider.id);
  return { provider, key };
}

// ============================================
// FAILOVER SYSTEM
// ============================================

export async function markKeyStatus(keyId: string, status: string, cooldownMs?: number) {
  const updateData: any = { status, updated_at: new Date().toISOString() };

  if (cooldownMs) {
    updateData.cooldown_until = new Date(Date.now() + cooldownMs).toISOString();
  }

  if (status === 'rate_limited') {
    updateData.rate_limit_reset_at = new Date(Date.now() + 60000).toISOString();
  }

  await update('provider_keys', updateData, { id: keyId });

  // Force cache refresh
  lastCacheRefresh = 0;
}

export async function incrementKeyUsage(keyId: string) {
  // Get current key first
  const keyResult = await query('provider_keys', { filter: { id: keyId } });
  if (keyResult.rows.length > 0) {
    const current = keyResult.rows[0];
    await update('provider_keys', {
      usage_count: (current.usage_count || 0) + 1,
      daily_usage_count: (current.daily_usage_count || 0) + 1,
      last_used_at: new Date().toISOString(),
    }, { id: keyId });
  }
}

// Get another key from the SAME provider (excluding the failed key)
export async function getNextKeyFromSameProvider(
  providerId: string,
  failedKeyId: string
): Promise<ProviderKeyInfo | null> {
  await refreshCache();

  const keys = keyPoolCache.get(providerId) || [];
  // Filter out the failed key
  const otherKeys = keys.filter(k => k.id !== failedKeyId);

  if (otherKeys.length === 0) return null;

  const provider = providerCache.find(p => p.id === providerId);
  if (!provider) return null;

  return selectKey(otherKeys, provider.load_balance, provider.id);
}

// Get a key from a DIFFERENT provider (last resort)
export async function getFailoverProviderAndKey(
  originalProviderId: string,
  modelName: string
): Promise<{
  provider: ProviderInfo;
  key: ProviderKeyInfo;
} | null> {
  await refreshCache();

  for (const provider of providerCache) {
    if (provider.id === originalProviderId) continue;
    if (!provider.failover_enabled) continue;

    const keys = keyPoolCache.get(provider.id) || [];
    if (keys.length === 0) continue;

    const key = selectKey(keys, provider.load_balance, provider.id);
    return { provider, key };
  }

  return null;
}
