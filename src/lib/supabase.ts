import { createClient } from '@supabase/supabase-js';
import { env } from './env';

// Only the public anon key is ever used in the browser; Row Level Security protects all data.
// If the app is not configured we still create a client (pointed at a placeholder) so imports
// never crash; the UI shows a setup screen instead of calling it.
export const supabase = createClient(env.supabaseUrl || 'http://localhost:54321', env.supabaseAnonKey || 'not-configured', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});
