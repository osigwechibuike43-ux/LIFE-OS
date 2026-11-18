import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { Logo } from '@/components/Logo';
import { Button, ErrorState, Spinner } from '@/components/ui';
import { useAuth } from '@/features/auth/AuthProvider';
import { useProfile } from '@/hooks/queries';
import { isConfigured } from '@/lib/env';

export function FullScreenLoader() {
  return <div className="flex min-h-screen items-center justify-center bg-bg"><Spinner className="h-7 w-7" /></div>;
}

export function ConfigMissing() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg p-6">
      <div className="card max-w-lg p-8">
        <Logo />
        <h1 className="mt-6 text-xl font-semibold">Supabase is not configured</h1>
        <p className="mt-2 text-sm text-muted">LIFE OS needs a Supabase project for authentication and data. Nothing is simulated in its place.</p>
        <ol className="mt-4 list-decimal space-y-1.5 pl-5 text-sm">
          <li>Copy <code className="rounded bg-surface-2 px-1.5">.env.example</code> to <code className="rounded bg-surface-2 px-1.5">.env</code></li>
          <li>Set <code className="rounded bg-surface-2 px-1.5">VITE_SUPABASE_URL</code> and <code className="rounded bg-surface-2 px-1.5">VITE_SUPABASE_ANON_KEY</code></li>
          <li>Apply the migrations in <code className="rounded bg-surface-2 px-1.5">supabase/migrations</code></li>
          <li>Restart the dev server</li>
        </ol>
        <p className="mt-4 text-xs text-muted">Full instructions are in docs/SETUP.md.</p>
      </div>
    </div>
  );
}

/** Requires a signed-in user. */
export function RequireAuth() {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (!isConfigured) return <ConfigMissing />;
  if (loading) return <FullScreenLoader />;
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />;
  return <Outlet />;
}

/** Sends new users through onboarding exactly once. */
export function RequireOnboarded() {
  const profile = useProfile();
  if (profile.isLoading) return <FullScreenLoader />;
  if (profile.isError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg">
        <ErrorState message="We could not load your profile. If this is a new project, check that the database migrations were applied." onRetry={() => profile.refetch()} />
      </div>
    );
  }
  if (!profile.data?.onboarding_completed) return <Navigate to="/onboarding" replace />;
  return <Outlet />;
}

/** Keeps signed-in users away from login/signup. */
export function PublicOnly() {
  const { user, loading } = useAuth();
  if (!isConfigured) return <Outlet />;
  if (loading) return <FullScreenLoader />;
  if (user) return <Navigate to="/app" replace />;
  return <Outlet />;
}

export function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-bg p-6 text-center">
      <Logo />
      <h1 className="mt-4 text-3xl font-semibold">Page not found</h1>
      <p className="text-sm text-muted">The page you are looking for does not exist or has moved.</p>
      <a href="/"><Button>Back home</Button></a>
    </div>
  );
}
