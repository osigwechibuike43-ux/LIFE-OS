import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
import { Logo } from '@/components/Logo';
import { Button, Input, Select, Switch } from '@/components/ui';
import { useToast } from '@/components/ui/Toast';
import { useProfile } from '@/hooks/queries';
import { commonTimeZones, isValidTimeZone } from '@/lib/dates';
import { cn, errorMessage } from '@/lib/utils';
import { prefsApi, profileApi } from '@/services/data';

const USE_CASES = [
  ['student', 'Student'], ['professional', 'Professional'], ['entrepreneur', 'Entrepreneur'], ['business_owner', 'Business owner'],
  ['freelancer', 'Freelancer'], ['family', 'Family'], ['personal', 'Everyday life'],
] as const;
const INTERESTS = ['Study & learning', 'Work projects', 'Business', 'Health & fitness', 'Finance', 'Creative work', 'Family & home', 'Travel', 'Personal growth', 'Side projects'];

export default function OnboardingPage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const profile = useProfile();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: '', useCase: '', interests: [] as string[],
    tz: isValidTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone) ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC',
    inApp: true, memory: true, aiSave: false,
  });
  const name = form.name || profile.data?.display_name || '';
  const steps = ['About you', 'Interests', 'Preferences', 'AI & memory'];

  async function finish(skip = false) {
    setSaving(true);
    try {
      await profileApi.update({
        display_name: (name || '').trim().slice(0, 80) || null,
        ...(skip ? {} : { primary_use_case: form.useCase || null, interests: form.interests, timezone: form.tz }),
        onboarding_completed: true,
      });
      if (!skip) await prefsApi.update({ notifications_in_app: form.inApp, memory_enabled: form.memory, ai_can_save_memory: form.memory && form.aiSave });
      await qc.invalidateQueries();
      nav('/app', { replace: true });
    } catch (e) { toast.error(errorMessage(e)); } finally { setSaving(false); }
  }

  const toggleInterest = (i: string) => setForm((f) => ({ ...f, interests: f.interests.includes(i) ? f.interests.filter((x) => x !== i) : [...f.interests, i].slice(0, 8) }));

  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <header className="flex items-center justify-between px-5 py-5 sm:px-10">
        <Logo />
        <Button variant="ghost" size="sm" onClick={() => finish(true)} disabled={saving}>Skip for now</Button>
      </header>
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-5 pb-16">
        <div className="mb-8 flex gap-1.5" role="progressbar" aria-valuemin={1} aria-valuemax={steps.length} aria-valuenow={step + 1} aria-label="Onboarding progress">
          {steps.map((s, i) => <span key={s} className={cn('h-1 flex-1 rounded-full transition-colors', i <= step ? 'bg-accent' : 'bg-line')} />)}
        </div>
        <p className="text-xs font-medium uppercase tracking-wider text-accent">Step {step + 1} of {steps.length}</p>

        {step === 0 && (
          <section className="mt-2 space-y-5">
            <h1 className="text-3xl font-semibold">Let’s make LIFE OS yours</h1>
            <p className="text-muted">How should we greet you, and what will you use it for most?</p>
            <Input label="Display name" value={name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} maxLength={80} autoFocus />
            <div>
              <p className="label">Primary use</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {USE_CASES.map(([v, l]) => (
                  <button key={v} type="button" aria-pressed={form.useCase === v} onClick={() => setForm((f) => ({ ...f, useCase: v }))}
                    className={cn('rounded-xl border px-3 py-3 text-sm transition-colors', form.useCase === v ? 'border-accent bg-accent/10 text-accent' : 'border-line bg-surface hover:bg-surface-2')}>{l}</button>
                ))}
              </div>
            </div>
          </section>
        )}

        {step === 1 && (
          <section className="mt-2 space-y-5">
            <h1 className="text-3xl font-semibold">What matters to you?</h1>
            <p className="text-muted">Pick up to eight. This only tunes suggestions; you can change it any time.</p>
            <div className="flex flex-wrap gap-2">
              {INTERESTS.map((i) => {
                const on = form.interests.includes(i);
                return (
                  <button key={i} type="button" aria-pressed={on} onClick={() => toggleInterest(i)}
                    className={cn('inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-sm transition-colors', on ? 'border-accent bg-accent/10 text-accent' : 'border-line bg-surface hover:bg-surface-2')}>
                    {on && <Check className="h-3.5 w-3.5" />}{i}
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {step === 2 && (
          <section className="mt-2 space-y-5">
            <h1 className="text-3xl font-semibold">Time & notifications</h1>
            <p className="text-muted">Reminders and your daily plan follow your timezone.</p>
            <Select label="Timezone" value={form.tz} onChange={(e) => setForm((f) => ({ ...f, tz: e.target.value }))}>
              {commonTimeZones().map((z) => <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>)}
            </Select>
            <div className="card p-4">
              <Switch checked={form.inApp} onChange={(v) => setForm((f) => ({ ...f, inApp: v }))} label="In-app notifications" description="Reminders and automation results appear in your notification bell. You can enable browser push later in Settings." />
            </div>
          </section>
        )}

        {step === 3 && (
          <section className="mt-2 space-y-5">
            <h1 className="text-3xl font-semibold">You control what it remembers</h1>
            <p className="text-muted">Nothing is saved silently. The assistant asks for your approval before every memory.</p>
            <div className="card space-y-5 p-4">
              <Switch checked={form.memory} onChange={(v) => setForm((f) => ({ ...f, memory: v, aiSave: v ? f.aiSave : false }))} label="Enable personal memory" description="Lets you keep preferences, goals and important dates that the assistant can use." />
              <Switch checked={form.aiSave} disabled={!form.memory} onChange={(v) => setForm((f) => ({ ...f, aiSave: v }))} label="Let the assistant propose memories" description="It can only suggest. You approve each one." />
            </div>
          </section>
        )}

        <div className="mt-10 flex items-center justify-between">
          <Button variant="ghost" onClick={() => setStep((s) => s - 1)} disabled={step === 0 || saving}><ArrowLeft className="h-4 w-4" />Back</Button>
          {step < steps.length - 1
            ? <Button onClick={() => setStep((s) => s + 1)}>Continue<ArrowRight className="h-4 w-4" /></Button>
            : <Button onClick={() => finish(false)} loading={saving}>Finish setup</Button>}
        </div>
      </main>
    </div>
  );
}
