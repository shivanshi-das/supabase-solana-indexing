// Supabase Admin Client (Server-side / Indexer)
// Uses SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
// ⚠️ WARNING: Never use this in browser/client code!

import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Load environment variables from .env file
// This is safe in Node.js environments (indexer)
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('dotenv').config();
} catch {
  // dotenv may not be available in all environments, that's okay
}

let adminClient: SupabaseClient | null = null;

/**
 * Get or create the admin Supabase client
 * Uses SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
 * Bypasses Row Level Security (RLS) - use only in server-side code
 * 
 * @throws {Error} If required environment variables are missing
 * 
 * @example
 * ```ts
 * import { getSupabaseAdmin } from './lib/supabaseClient.admin';
 * const admin = getSupabaseAdmin();
 * const { data } = await admin.from('indexed_accounts').select('*');
 * ```
 */
export function getSupabaseAdmin(): SupabaseClient {
  if (adminClient) {
    return adminClient;
  }

  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      'Missing SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) or SUPABASE_SERVICE_ROLE_KEY. ' +
      'Add them to .env file in the indexer directory.'
    );
  }

  adminClient = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return adminClient;
}

