// Supabase Client Configuration (Legacy - for backward compatibility)
// This file re-exports from the split client files
// New code should use supabaseClient.browser.ts or supabaseClient.admin.ts directly

// Re-export browser client for frontend use
export { getSupabaseBrowser, supabase } from './supabaseClient.browser';

// Re-export admin client for server-side use
export { getSupabaseAdmin } from './supabaseClient.admin';

