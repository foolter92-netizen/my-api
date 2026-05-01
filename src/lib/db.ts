import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

let supabase: SupabaseClient | null = null;

function getSupabase(): SupabaseClient {
  if (!supabase) {
    supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return supabase;
}

export interface QueryResult {
  rows: any[];
  rowCount: number;
}

export async function query(table: string, options?: {
  select?: string;
  filter?: Record<string, any>;
  order?: string;
  limit?: number;
  offset?: number;
}): Promise<QueryResult> {
  const sb = getSupabase();
  let query = sb.from(table).select(options?.select || '*');

  if (options?.filter) {
    for (const [key, value] of Object.entries(options.filter)) {
      if (value !== undefined && value !== null) {
        query = query.eq(key, value);
      }
    }
  }

  if (options?.order) {
    const desc = options.order.startsWith('-');
    const col = desc ? options.order.slice(1) : options.order;
    query = query.order(col, { ascending: !desc });
  }

  if (options?.limit) query = query.limit(options.limit);
  if (options?.offset) query = query.range(options.offset, options.offset + (options.limit || 50) - 1);

  const { data, error, count } = await query;
  if (error) throw error;
  return { rows: data || [], rowCount: count || data?.length || 0 };
}

// Raw SQL query via Supabase RPC
export async function rawQuery(sql: string, params?: any[]): Promise<QueryResult> {
  const sb = getSupabase();
  const { data, error } = await sb.rpc('exec_sql', { query: sql });
  if (error) {
    // Fallback: return empty if RPC not available
    console.error('RPC error:', error.message);
    return { rows: [], rowCount: 0 };
  }
  return { rows: data || [], rowCount: data?.length || 0 };
}

// Helper for insert
export async function insert(table: string, data: any | any[]): Promise<any> {
  const sb = getSupabase();
  const { data: result, error } = await sb.from(table).insert(data).select();
  if (error) throw error;
  return result;
}

// Helper for update
export async function update(table: string, data: any, filter: Record<string, any>): Promise<any> {
  const sb = getSupabase();
  let query = sb.from(table).update(data);
  for (const [key, value] of Object.entries(filter)) {
    query = query.eq(key, value);
  }
  const { data: result, error } = await query.select();
  if (error) throw error;
  return result;
}

// Helper for delete
export async function remove(table: string, filter: Record<string, any>): Promise<void> {
  const sb = getSupabase();
  let query = sb.from(table).delete();
  for (const [key, value] of Object.entries(filter)) {
    query = query.eq(key, value);
  }
  const { error } = await query;
  if (error) throw error;
}

// Helper for single row select
export async function findOne(table: string, filter: Record<string, any>, select: string = '*'): Promise<any | null> {
  const sb = getSupabase();
  let query = sb.from(table).select(select);
  for (const [key, value] of Object.entries(filter)) {
    query = query.eq(key, value);
  }
  const { data, error } = await query.limit(1).single();
  if (error) return null;
  return data;
}

const db = { query, insert, update, remove, findOne };
export default db;
