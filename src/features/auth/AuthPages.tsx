import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, MailCheck } from 'lucide-react';
import { Button, Input } from '@/components/ui';
import { useToast } from '@/components/ui/Toast';
import { fieldErrors, loginSchema, newPasswordSchema, resetSchema, signupSchema } from '@/lib/validation';
import { supabase } from '@/lib/supabase';
import { AuthLayout, GoogleIcon } from './AuthLayout';
import { authErrorMessage, useAuth } from './AuthProvider';

function PasswordInput({ label, error, ...rest }: { label: string; error?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input label={label} error={error} type={show ? 'text' : 'password'} className="pr-11" {...rest} />
      <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'}
        className="absolute right-3 top-[34px] text-muted hover:text-fg">
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

function GoogleButton() {
  const { signInWithGoogle } = useAuth();
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  return (
    <Button variant="secondary" className="w-full" loading={loading} onClick={async () => {
      setLoading(true);
      try { await signInWithGoogle(); } catch (e) { toast.error(authErrorMessage(e)); setLoading(false); }
    }}>
      {!loading && <GoogleIcon />}Continue with Google
    </Button>
  );
}

const Divider = () => (
  <div className="my-5 flex items-center gap-3 text-xs text-muted"><span className="h-px flex-1 bg-line" />or<span className="h-px flex-1 bg-line" /></div>
);

export function LoginPage() {
  const { signIn, resendVerification } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [loading, setLoading] = useState(false);
  const [unverified, setUnverified] = useState(false);
  const toast = useToast();
  const from = (loc.state as { from?: string } | null)?.from;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setFormError(''); setUnverified(false);
    const parsed = loginSchema.safeParse({ email, password });
    if (!parsed.success) return setErrors(fieldErrors(parsed));
    setErrors({}); setLoading(true);
    try {
      await signIn(parsed.data.email, parsed.data.password);
      nav(from && from.startsWith('/app') ? from : '/app', { replace: true });
    } catch (err) {
      setFormError(authErrorMessage(err));
      setUnverified(/email not confirmed/i.test((err as Error).message));
    } finally { setLoading(false); }
  }

  return (
    <AuthLayout title="Welcome back" subtitle="Sign in to continue to LIFE OS."
      footer={<>New here? <Link to="/signup" className="font-medium text-accent hover:underline">Create an account</Link></>}>
      <GoogleButton /><Divider />
      <form onSubmit={submit} noValidate className="space-y-4">
        <Input label="Email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} error={errors.email} placeholder="you@example.com" />
        <PasswordInput label="Password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} error={errors.password} />
        <div className="flex justify-end"><Link to="/forgot-password" className="text-xs font-medium text-accent hover:underline">Forgot password?</Link></div>
        {formError && <p role="alert" className="rounded-xl bg-danger/10 px-3.5 py-2.5 text-sm text-danger">{formError}</p>}
        {unverified && (
          <Button variant="secondary" size="sm" type="button" onClick={async () => {
            try { await resendVerification(email.trim().toLowerCase()); toast.success('Verification email sent.'); } catch (err) { toast.error(authErrorMessage(err)); }
          }}>Resend verification email</Button>
        )}
        <Button type="submit" className="w-full" loading={loading}>Sign in</Button>
      </form>
    </AuthLayout>
  );
}

export function SignupPage() {
  const { signUp, resendVerification } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', password: '', accept: false });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [loading, setLoading] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault(); setFormError('');
    const parsed = signupSchema.safeParse(form);
    if (!parsed.success) return setErrors(fieldErrors(parsed));
    setErrors({}); setLoading(true);
    try {
      const { needsVerification } = await signUp(parsed.data.name, parsed.data.email, parsed.data.password);
      if (needsVerification) setSentTo(parsed.data.email); else nav('/onboarding', { replace: true });
    } catch (err) { setFormError(authErrorMessage(err)); } finally { setLoading(false); }
  }

  if (sentTo) {
    return (
      <AuthLayout title="Check your email" footer={<Link to="/login" className="font-medium text-accent hover:underline">Back to sign in</Link>}>
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/12 text-accent"><MailCheck className="h-7 w-7" /></div>
          <p className="text-sm text-muted">We sent a verification link to <strong className="text-fg">{sentTo}</strong>. Open it to activate your account.</p>
          <Button variant="secondary" onClick={async () => { try { await resendVerification(sentTo); toast.success('Email sent again.'); } catch (err) { toast.error(authErrorMessage(err)); } }}>Resend email</Button>
        </div>
      </AuthLayout>
    );
  }

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: k === 'accept' ? e.target.checked : e.target.value }));
  return (
    <AuthLayout title="Create your account" subtitle="Free to start. No credit card required."
      footer={<>Already have an account? <Link to="/login" className="font-medium text-accent hover:underline">Sign in</Link></>}>
      <GoogleButton /><Divider />
      <form onSubmit={submit} noValidate className="space-y-4">
        <Input label="Name" autoComplete="name" value={form.name} onChange={set('name')} error={errors.name} />
        <Input label="Email" type="email" autoComplete="email" value={form.email} onChange={set('email')} error={errors.email} placeholder="you@example.com" />
        <PasswordInput label="Password" autoComplete="new-password" value={form.password} onChange={set('password')} error={errors.password} />
        <p className="-mt-2 text-xs text-muted">At least 8 characters with upper and lower case letters and a number.</p>
        <div>
          <label className="flex items-start gap-2.5 text-sm text-muted">
            <input type="checkbox" checked={form.accept} onChange={set('accept')} className="mt-0.5 h-4 w-4 rounded border-line accent-[rgb(var(--accent))]" />
            <span>I agree to the <Link to="/terms" target="_blank" className="text-accent hover:underline">Terms</Link> and <Link to="/privacy" target="_blank" className="text-accent hover:underline">Privacy Policy</Link>.</span>
          </label>
          {errors.accept && <p role="alert" className="mt-1.5 text-xs text-danger">{errors.accept}</p>}
        </div>
        {formError && <p role="alert" className="rounded-xl bg-danger/10 px-3.5 py-2.5 text-sm text-danger">{formError}</p>}
        <Button type="submit" className="w-full" loading={loading}>Create account</Button>
      </form>
    </AuthLayout>
  );
}

export function ForgotPasswordPage() {
  const { sendReset } = useAuth();
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = resetSchema.safeParse({ email });
    if (!parsed.success) return setError(fieldErrors(parsed).email ?? 'Enter a valid email');
    setError(''); setLoading(true);
    try { await sendReset(parsed.data.email); setSent(true); } catch (err) { setError(authErrorMessage(err)); } finally { setLoading(false); }
  }

  return (
    <AuthLayout title="Reset your password" subtitle="Enter your email and we will send you a reset link."
      footer={<Link to="/login" className="font-medium text-accent hover:underline">Back to sign in</Link>}>
      {sent ? (
        <p role="status" className="rounded-xl bg-success/10 px-4 py-3 text-sm text-success">If an account exists for that email, a reset link is on its way.</p>
      ) : (
        <form onSubmit={submit} noValidate className="space-y-4">
          <Input label="Email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} error={error} />
          <Button type="submit" className="w-full" loading={loading}>Send reset link</Button>
        </form>
      )}
    </AuthLayout>
  );
}

export function ResetPasswordPage() {
  const { updatePassword, session, loading: authLoading } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const [form, setForm] = useState({ password: '', confirm: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = newPasswordSchema.safeParse(form);
    if (!parsed.success) return setErrors(fieldErrors(parsed));
    setErrors({}); setLoading(true);
    try { await updatePassword(parsed.data.password); toast.success('Password updated.'); nav('/app', { replace: true }); }
    catch (err) { toast.error(authErrorMessage(err)); } finally { setLoading(false); }
  }

  // The recovery link signs the user in temporarily; without it the page has nothing to authorise.
  if (!authLoading && !session) {
    return (
      <AuthLayout title="Link expired" footer={<Link to="/forgot-password" className="font-medium text-accent hover:underline">Request a new link</Link>}>
        <p className="text-sm text-muted">This reset link is invalid or has expired.</p>
      </AuthLayout>
    );
  }
  return (
    <AuthLayout title="Choose a new password">
      <form onSubmit={submit} noValidate className="space-y-4">
        <PasswordInput label="New password" autoComplete="new-password" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} error={errors.password} />
        <PasswordInput label="Confirm password" autoComplete="new-password" value={form.confirm} onChange={(e) => setForm((f) => ({ ...f, confirm: e.target.value }))} error={errors.confirm} />
        <Button type="submit" className="w-full" loading={loading}>Update password</Button>
      </form>
    </AuthLayout>
  );
}

/** Landing target for email-verification and OAuth redirects. */
export function AuthCallbackPage() {
  const nav = useNavigate();
  const { user, loading } = useAuth();
  const [error, setError] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const desc = params.get('error_description') ?? new URLSearchParams(window.location.hash.slice(1)).get('error_description');
    if (desc) { setError(desc); return; }
    const code = params.get('code');
    if (code) void supabase.auth.exchangeCodeForSession(code).catch(() => setError('This link is invalid or has expired.'));
  }, []);

  useEffect(() => { if (!loading && user) nav('/app', { replace: true }); }, [user, loading, nav]);

  if (error) {
    return (
      <AuthLayout title="Could not sign you in" footer={<Link to="/login" className="font-medium text-accent hover:underline">Back to sign in</Link>}>
        <p className="text-sm text-danger">{error}</p>
      </AuthLayout>
    );
  }
  return <div className="flex min-h-screen items-center justify-center text-sm text-muted">Signing you in…</div>;
}
