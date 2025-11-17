// Supabase Browser Client (Frontend)
// Uses NEXT_PUBLIC_* environment variables for client-side use
// Safe to use in React components and browser code

import { createClient, SupabaseClient } from '@supabase/supabase-js';

let supabaseClient: SupabaseClient | null = null;

/**
 * Get or create the browser Supabase client
 * Uses NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY
 * 
 * @throws {Error} If required environment variables are missing
 * 
 * @example
 * ```tsx
 * import { getSupabaseBrowser } from '@/lib/supabaseClient.browser';
 * const supabase = getSupabaseBrowser();
 * const { data } = await supabase.from('indexed_accounts').select('*');
 * ```
 */
export function getSupabaseBrowser(): SupabaseClient {
  if (supabaseClient) {
    return supabaseClient;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anon) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. Add them to .env.local'
    );
  }

  supabaseClient = createClient(url, anon, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });

  return supabaseClient;
}

/**
 * Default export for convenience
 */
export const supabase = getSupabaseBrowser();

