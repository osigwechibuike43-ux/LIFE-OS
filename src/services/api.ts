import { supabase } from '@/lib/supabase';

/** Turns setup problems into actionable messages instead of raw PostgREST codes. */
export function friendlyDbError(error: { message: string; code?: string }): string {
  if (error.code === 'PGRST106' || /invalid schema|schema must be one of/i.test(error.message)) {
    return 'The "lifeos" schema is not exposed by your Supabase API. In Supabase go to Settings > API > Exposed schemas, add "lifeos", and save.';
  }
  if (error.code === '42P01' || /relation .* does not exist|Could not find the (table|function)/i.test(error.message)) {
    return 'LIFE OS database tables are missing. Apply the migrations in supabase/migrations (see docs/SETUP.md).';
  }
  return error.message;
}

/** Unwraps a Supabase response: throws the error, returns the data. Keeps services small and errors uniform. */
export async function unwrap<T = unknown>(p: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(friendlyDbError(error));
  return data as T;
}

export async function currentUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getSession();
  const id = data.session?.user.id;
  if (error || !id) throw new Error('Not authenticated');
  return id;
}

export const PAGE_SIZE = 25;
