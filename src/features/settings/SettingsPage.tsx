import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Bell, Bot, Download, KeyRound, Monitor, Moon, Palette, ShieldCheck, Sun, Trash2, User } from 'lucide-react';
import { Badge, Button, Input, Modal, PageHeader, Select, Skeleton, Switch } from '@/components/ui';
import { useToast } from '@/components/ui/Toast';
import { authErrorMessage, useAuth } from '@/features/auth/AuthProvider';
import { useAppMutation, useEntitlements, usePrefs, useProfile } from '@/hooks/queries';
import { useTheme, type ThemePref } from '@/hooks/useTheme';
import { commonTimeZones } from '@/lib/dates';
import { downloadJson } from '@/lib/download';
import { env } from '@/lib/env';
import { supabase } from '@/lib/supabase';
import { cn, errorMessage } from '@/lib/utils';
import { newPasswordSchema, fieldErrors } from '@/lib/validation';
import { disablePush, enablePush, pushConfigured, pushSupported } from '@/services/push';
import { exportApi, prefsApi, profileApi, useProviderQuery } from './settingsData';

const SECTIONS = [
  { id: 'profile', label: 'Profile', icon: User }, { id: 'security', label: 'Account & security', icon: KeyRound },
  { id: 'appearance', label: 'Appearance', icon: Palette }, { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'ai', label: 'AI & memory', icon: Bot }, { id: 'privacy', label: 'Privacy & data', icon: ShieldCheck },
] as const;

function Section({ id, title, description, children }: { id: string; title: string; description?: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="card scroll-mt-24 p-5 sm:p-6">
      <h2 id={`${id}-h`} className="text-base font-semibold">{title}</h2>
      {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      <div className="mt-5 space-y-5">{children}</div>
    </section>
  );
}

export default function SettingsPage() {
  return (
    <div>
      <PageHeader title="Settings" description="Your profile, preferences and privacy controls." />
      <div className="grid gap-6 lg:grid-cols-[200px_1fr]">
        <nav aria-label="Settings sections" className="flex gap-1 overflow-x-auto lg:sticky lg:top-24 lg:h-fit lg:flex-col">
          {SECTIONS.map((s) => <a key={s.id} href={`#${s.id}`} className="flex shrink-0 items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-muted hover:bg-surface-2 hover:text-fg"><s.icon className="h-4 w-4" />{s.label}</a>)}
        </nav>
        <div className="min-w-0 space-y-5">
          <ProfileSection /><SecuritySection /><AppearanceSection /><NotificationSection /><AiSection /><PrivacySection />
        </div>
      </div>
    </div>
  );
}

function ProfileSection() {
  const profile = useProfile();
  const [name, setName] = useState('');
  const [tz, setTz] = useState('UTC');
  const [useCase, setUseCase] = useState('');
  useEffect(() => { if (profile.data) { setName(profile.data.display_name ?? ''); setTz(profile.data.timezone); setUseCase(profile.data.primary_use_case ?? ''); } }, [profile.data]);
  const save = useAppMutation(() => profileApi.update({ display_name: name.trim().slice(0, 80) || null, timezone: tz, primary_use_case: useCase || null }), { invalidate: ['profile'], success: 'Profile saved' });
  const ent = useEntitlements();
  if (profile.isLoading) return <Skeleton className="h-64" />;
  return (
    <Section id="profile" title="Profile">
      <Input label="Display name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} error={name.trim() ? undefined : 'Enter a name'} />
      <Select label="Primary use" value={useCase} onChange={(e) => setUseCase(e.target.value)}>
        <option value="">Not set</option>{[['student', 'Student'], ['professional', 'Professional'], ['entrepreneur', 'Entrepreneur'], ['business_owner', 'Business owner'], ['freelancer', 'Freelancer'], ['family', 'Family'], ['personal', 'Everyday life']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </Select>
      <Select label="Timezone" value={tz} onChange={(e) => setTz(e.target.value)} hint="Reminders, your calendar and automations use this timezone.">{commonTimeZones().map((z) => <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>)}</Select>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted">Plan: <Badge tone="accent">{ent.data?.plan_name ?? profile.data?.plan_id ?? 'Free'}</Badge> <span className="text-xs">(billing is not enabled yet)</span></p>
        <Button onClick={() => save.mutate(undefined)} loading={save.isPending} disabled={!name.trim()}>Save profile</Button>
      </div>
    </Section>
  );
}

function SecuritySection() {
  const { user, updatePassword } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const [f, setF] = useState({ password: '', confirm: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const isOAuth = user?.app_metadata?.provider && user.app_metadata.provider !== 'email';

  async function change() {
    const parsed = newPasswordSchema.safeParse(f);
    if (!parsed.success) return setErrors(fieldErrors(parsed));
    setErrors({}); setBusy(true);
    try { await updatePassword(parsed.data.password); setF({ password: '', confirm: '' }); toast.success('Password updated'); } catch (e) { toast.error(authErrorMessage(e)); } finally { setBusy(false); }
  }
  async function signOutAll() {
    try { const { error } = await supabase.auth.signOut({ scope: 'global' }); if (error) throw error; nav('/login', { replace: true }); } catch (e) { toast.error(authErrorMessage(e)); }
  }
  return (
    <Section id="security" title="Account & security">
      <div><p className="label">Email</p><p className="text-sm">{user?.email} {user?.email_confirmed_at ? <Badge tone="success">Verified</Badge> : <Badge tone="warning">Not verified</Badge>}</p>
        {isOAuth && <p className="mt-1 text-xs text-muted">Signed in with {String(user?.app_metadata.provider)}.</p>}</div>
      <div className="space-y-3">
        <p className="text-sm font-medium">Change password</p>
        <Input label="New password" type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} error={errors.password} />
        <Input label="Confirm new password" type="password" autoComplete="new-password" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} error={errors.confirm} />
        <Button onClick={change} loading={busy} disabled={!f.password}>Update password</Button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
        <div><p className="text-sm font-medium">Sign out everywhere</p><p className="text-xs text-muted">Ends your session on all devices.</p></div>
        <Button variant="secondary" onClick={signOutAll}>Sign out of all devices</Button>
      </div>
    </Section>
  );
}

function AppearanceSection() {
  const { pref, setPref } = useTheme();
  const opts: Array<[ThemePref, string, typeof Sun]> = [['light', 'Light', Sun], ['dark', 'Dark', Moon], ['system', 'System', Monitor]];
  return (
    <Section id="appearance" title="Appearance" description="Applies on this device.">
      <div className="grid grid-cols-3 gap-3" role="radiogroup" aria-label="Theme">
        {opts.map(([v, l, Icon]) => (
          <button key={v} role="radio" aria-checked={pref === v} onClick={() => setPref(v)} className={cn('flex flex-col items-center gap-2 rounded-xl border px-3 py-4 text-sm transition-colors', pref === v ? 'border-accent bg-accent/10 text-accent' : 'border-line hover:bg-surface-2')}><Icon className="h-5 w-5" />{l}</button>
        ))}
      </div>
    </Section>
  );
}

function NotificationSection() {
  const prefs = usePrefs();
  const toast = useToast();
  const [pushBusy, setPushBusy] = useState(false);
  const set = useAppMutation((p: Parameters<typeof prefsApi.update>[0]) => prefsApi.update(p), { invalidate: ['prefs'] });
  const p = prefs.data;
  if (!p) return <Skeleton className="h-48" />;

  async function togglePush(on: boolean) {
    setPushBusy(true);
    try {
      if (on) { await enablePush(); await prefsApi.update({ notifications_push: true }); toast.success('Push notifications enabled on this device'); }
      else { await disablePush(); await prefsApi.update({ notifications_push: false }); }
      set.mutate({}); // refresh
    } catch (e) { toast.error(errorMessage(e)); } finally { setPushBusy(false); }
  }
  const pushReason = !pushSupported() ? 'This browser does not support push.' : !pushConfigured() ? 'Not configured: the server needs VAPID keys (see docs/SETUP.md).' : Notification.permission === 'denied' ? 'Blocked in your browser settings.' : '';
  return (
    <Section id="notifications" title="Notifications">
      <Switch checked={p.notifications_in_app} label="In-app notifications" description="Reminders and automation results in your notification bell." onChange={(v) => set.mutate({ notifications_in_app: v })} disabled={set.isPending} />
      <Switch checked={p.notifications_push} label="Web push notifications" description={pushReason || 'Get reminders even when LIFE OS is closed. Asks for browser permission.'} disabled={Boolean(pushReason) || pushBusy} onChange={togglePush} />
      <div><p className="label">Week starts on</p><Select aria-label="Week starts on" className="w-48" value={p.week_starts_on} onChange={(e) => set.mutate({ week_starts_on: Number(e.target.value) })}><option value={1}>Monday</option><option value={0}>Sunday</option><option value={6}>Saturday</option></Select></div>
    </Section>
  );
}

function AiSection() {
  const prefs = usePrefs();
  const provider = useProviderQuery();
  const [model, setModel] = useState('');
  const [prov, setProv] = useState('default');
  useEffect(() => { if (provider.data) { setProv(provider.data.provider); setModel(provider.data.model ?? ''); } }, [provider.data]);
  const set = useAppMutation((p: Parameters<typeof prefsApi.update>[0]) => prefsApi.update(p), { invalidate: ['prefs'] });
  const saveProv = useAppMutation(() => prefsApi.setProvider(prov, prov === 'default' ? null : model.trim() || null), { invalidate: ['ai-provider'], success: 'AI preferences saved' });
  const p = prefs.data;
  if (!p) return <Skeleton className="h-48" />;
  const modelOk = !model || /^[\w.\-:/]{1,100}$/.test(model);
  return (
    <Section id="ai" title="AI & memory" description="Keys are stored on the server only. This chooses which configured provider answers you.">
      <Switch checked={p.ai_enabled} label="Enable the AI assistant" onChange={(v) => set.mutate({ ai_enabled: v })} disabled={set.isPending} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Select label="Provider" value={prov} onChange={(e) => setProv(e.target.value)}><option value="default">Server default</option><option value="groq">Groq</option><option value="gemini">Google Gemini</option><option value="openai">OpenAI</option></Select>
        <Input label="Model (optional)" value={model} onChange={(e) => setModel(e.target.value)} disabled={prov === 'default'} placeholder="Provider default" error={modelOk ? undefined : 'Use letters, numbers, . - : /'} />
      </div>
      <p className="-mt-2 text-xs text-muted">If the chosen provider has no key on the server, the default is used.</p>
      <Button variant="secondary" onClick={() => saveProv.mutate(undefined)} loading={saveProv.isPending} disabled={!modelOk}>Save AI preferences</Button>
      <div className="space-y-5 border-t border-line pt-5">
        <Switch checked={p.memory_enabled} label="Personal memory" description="When off, the assistant cannot read or save memories." onChange={(v) => set.mutate({ memory_enabled: v, ...(v ? {} : { ai_can_save_memory: false }) })} disabled={set.isPending} />
        <Switch checked={p.memory_enabled && p.ai_can_save_memory} label="Allow the assistant to propose memories" description="Every proposal still needs your approval." disabled={!p.memory_enabled || set.isPending} onChange={(v) => set.mutate({ ai_can_save_memory: v })} />
        <Link to="/app/memory" className="text-sm text-accent hover:underline">Manage your memories →</Link>
      </div>
    </Section>
  );
}

function PrivacySection() {
  const toast = useToast();
  const qc = useQueryClient();
  const nav = useNavigate();
  const { signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [deleting, setDeleting] = useState(false);
  const exporting = useAppMutation(exportApi.all, { onSuccess: (d) => downloadJson(d, `life-os-export-${new Date().toISOString().slice(0, 10)}.json`), success: 'Your data export has downloaded' });

  async function deleteAccount() {
    setDeleting(true);
    try {
      const { data } = await supabase.auth.getSession();
      const res = await fetch(`${env.supabaseUrl}/functions/v1/lifeos-delete-account`, { method: 'POST', headers: { authorization: `Bearer ${data.session?.access_token}`, apikey: env.supabaseAnonKey, 'content-type': 'application/json' }, body: JSON.stringify({ confirm: 'DELETE' }) });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.message ?? 'Could not delete your data.');
      await signOut().catch(() => undefined); qc.clear(); nav('/', { replace: true });
    } catch (e) { toast.error(errorMessage(e)); setDeleting(false); }
  }

  return (
    <Section id="privacy" title="Privacy & data" description="Your data belongs to you. You can take it with you or erase it.">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><p className="text-sm font-medium">Export your data</p><p className="text-xs text-muted">Tasks, notes, memories, conversations and more as JSON. Uploaded files can be downloaded from Documents.</p></div>
        <Button variant="secondary" onClick={() => exporting.mutate(undefined)} loading={exporting.isPending}><Download className="h-4 w-4" />Export</Button>
      </div>
      <p className="text-xs text-muted">Read our <Link to="/privacy" className="text-accent hover:underline">Privacy Policy</Link> and <Link to="/terms" className="text-accent hover:underline">Terms</Link>.</p>
      <div className="rounded-xl border border-danger/30 bg-danger/5 p-4">
        <p className="text-sm font-medium text-danger">Delete my LIFE OS data</p>
        <p className="mt-1 text-xs text-muted">Permanently deletes your tasks, notes, documents, memories and all other LIFE OS data, then signs you out. Your sign-in is kept because it is shared with other apps you may use. This cannot be undone.</p>
        <Button variant="danger" size="sm" className="mt-3" onClick={() => setOpen(true)}><Trash2 className="h-4 w-4" />Delete my data</Button>
      </div>
      <Modal open={open} onClose={() => !deleting && setOpen(false)} title="Delete all LIFE OS data?" footer={<><Button variant="secondary" onClick={() => setOpen(false)} disabled={deleting}>Cancel</Button><Button variant="danger" disabled={confirm !== 'DELETE'} loading={deleting} onClick={deleteAccount}>Delete forever</Button></>}>
        <p className="mb-4 text-sm text-muted">All your LIFE OS data will be erased. Consider exporting your data first. Type <strong className="text-fg">DELETE</strong> to confirm.</p>
        <Input aria-label="Type DELETE to confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" />
      </Modal>
    </Section>
  );
}
