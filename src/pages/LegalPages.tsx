import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Logo } from '@/components/Logo';

function Doc({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-bg">
      <header className="border-b border-line"><div className="mx-auto flex h-16 max-w-3xl items-center justify-between px-5"><Link to="/"><Logo /></Link><Link to="/" className="text-sm text-muted hover:text-fg">Back home</Link></div></header>
      <main className="mx-auto max-w-3xl px-5 py-12">
        <h1 className="text-3xl font-semibold">{title}</h1><p className="mt-2 text-sm text-muted">Last updated {updated}</p>
        <div className="mt-6 rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm">This is a starting draft prepared for the product team. It must be reviewed by a qualified lawyer and completed with your company details before public launch.</div>
        <div className="mt-8 space-y-8 text-sm leading-7 text-muted [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-fg [&_li]:ml-5 [&_li]:list-disc">{children}</div>
      </main>
    </div>
  );
}

export function PrivacyPage() {
  return (
    <Doc title="Privacy Policy" updated="17 November 2026">
      <section><h2>1. Who we are</h2><p>LIFE OS (“we”) is a personal organisation service. [Company legal name, address and contact email to be inserted.] We act as the data controller for personal data processed through the service.</p></section>
      <section><h2>2. What we collect</h2><ul><li>Account data: email address, display name, and sign-in identifiers (including Google if you use it).</li><li>Content you create: tasks, reminders, calendar events, notes, memories, planner entries, conversations with the assistant and uploaded documents.</li><li>Preferences: timezone, theme, notification and AI settings.</li><li>Operational data: activity and automation logs, and usage counts needed for fair-use limits. We do not log passwords, access tokens, API keys or document contents.</li></ul></section>
      <section><h2>3. How we use it</h2><p>To provide the features you use, secure your account, enforce usage limits, and send the notifications you enable. We do not sell personal data.</p></section>
      <section><h2>4. AI processing</h2><p>When you message the assistant, your message and the context needed to answer it (for example relevant tasks or memories you have kept, if memory is enabled) are sent to the configured AI provider (such as Groq, Google or OpenAI) to generate a reply. You control memory in Settings and can disable the assistant entirely. Document contents are not sent to AI providers.</p></section>
      <section><h2>5. Legal bases</h2><p>Where the Nigeria Data Protection Act 2023 (NDPA), the GDPR or similar laws apply, we rely on performance of our contract with you, your consent (for optional features such as push notifications and AI memory), and our legitimate interests in security and service improvement.</p></section>
      <section><h2>6. Your rights</h2><p>You may access, correct, export and delete your data. Export and account deletion are available in Settings. You may withdraw consent at any time and lodge a complaint with your data protection authority (in Nigeria, the Nigeria Data Protection Commission).</p></section>
      <section><h2>7. Security</h2><p>Data is encrypted in transit. Access to each record is restricted to its owner through database Row Level Security. Documents are stored privately and accessed through short-lived links. No system is perfectly secure and we will notify you and regulators of breaches as the law requires.</p></section>
      <section><h2>8. Retention and deletion</h2><p>We keep your data while your account is active. When you delete your account we delete your records and uploaded files. Backups are purged on a rolling schedule. [Retention period to be confirmed.]</p></section>
      <section><h2>9. International transfers</h2><p>Our infrastructure and AI providers may process data outside your country. We use contractual and technical safeguards where required. [Hosting regions to be confirmed.]</p></section>
      <section><h2>10. Contact</h2><p>[Data protection contact email to be inserted.]</p></section>
    </Doc>
  );
}

export function TermsPage() {
  return (
    <Doc title="Terms of Service" updated="17 November 2026">
      <section><h2>1. Agreement</h2><p>By creating an account you agree to these Terms and our Privacy Policy. If you do not agree, do not use LIFE OS.</p></section>
      <section><h2>2. Your account</h2><p>You are responsible for your credentials and for activity under your account. Provide accurate information and keep your password confidential.</p></section>
      <section><h2>3. Acceptable use</h2><ul><li>Do not attempt to access other users’ data or disrupt the service.</li><li>Do not upload unlawful content or malware.</li><li>Do not abuse the assistant or exceed fair-use limits.</li></ul></section>
      <section><h2>4. The assistant</h2><p>The assistant is an automated system that can make mistakes. Review its output before relying on it. It does not provide legal, medical or financial advice. Actions that change your data require your approval.</p></section>
      <section><h2>5. Your content</h2><p>You own your content. You grant us the limited licence needed to store and process it to operate the service for you.</p></section>
      <section><h2>6. Plans and fees</h2><p>LIFE OS is currently free. If paid plans are introduced we will give notice of prices and terms before any charge.</p></section>
      <section><h2>7. Availability and liability</h2><p>The service is provided “as is”. Reminders and notifications depend on third-party systems and may be delayed; do not rely on LIFE OS alone for safety-critical or legally critical deadlines. To the extent permitted by law we are not liable for indirect or consequential loss. [Liability cap and governing law (e.g. Federal Republic of Nigeria) to be confirmed by counsel.]</p></section>
      <section><h2>8. Termination</h2><p>You may delete your account at any time in Settings. We may suspend accounts that breach these Terms.</p></section>
      <section><h2>9. Changes</h2><p>We may update these Terms and will notify you of material changes.</p></section>
    </Doc>
  );
}
