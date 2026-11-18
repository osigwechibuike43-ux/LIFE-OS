import { supabase } from '@/lib/supabase';

/** Unwraps a Supabase response: throws the error, returns the data. Keeps services small and errors uniform. */
export async function unwrap<T = unknown>(p: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data as T;
}

export async function currentUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getSession();
  const id = data.session?.user.id;
  if (error || !id) throw new Error('Not authenticated');
  return id;
}

export const PAGE_SIZE = 25;
