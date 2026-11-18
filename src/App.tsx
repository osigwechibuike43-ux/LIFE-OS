import { lazy } from 'react';
import { Route, Routes } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { NotFound, PublicOnly, RequireAuth, RequireOnboarded } from '@/components/layout/guards';
import { AuthCallbackPage, ForgotPasswordPage, LoginPage, ResetPasswordPage, SignupPage } from '@/features/auth/AuthPages';
import LandingPage from '@/pages/LandingPage';

const Dashboard = lazy(() => import('@/features/dashboard/DashboardPage'));
const Assistant = lazy(() => import('@/features/assistant/AssistantPage'));
const Memory = lazy(() => import('@/features/memory/MemoryPage'));
const Tasks = lazy(() => import('@/features/tasks/TasksPage'));
const Calendar = lazy(() => import('@/features/calendar/CalendarPage'));
const Planner = lazy(() => import('@/features/planner/PlannerPage'));
const Notes = lazy(() => import('@/features/notes/NotesPage'));
const Documents = lazy(() => import('@/features/documents/DocumentsPage'));
const Automations = lazy(() => import('@/features/automations/AutomationsPage'));
const Insights = lazy(() => import('@/features/insights/InsightsPage'));
const Settings = lazy(() => import('@/features/settings/SettingsPage'));
const Onboarding = lazy(() => import('@/features/onboarding/OnboardingPage'));
const Privacy = lazy(() => import('@/pages/LegalPages').then((m) => ({ default: m.PrivacyPage })));
const Terms = lazy(() => import('@/pages/LegalPages').then((m) => ({ default: m.TermsPage })));

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/privacy" element={<Privacy />} />
      <Route path="/terms" element={<Terms />} />
      <Route element={<PublicOnly />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      </Route>
      <Route path="/auth/callback" element={<AuthCallbackPage />} />
      <Route path="/auth/reset" element={<ResetPasswordPage />} />
      <Route element={<RequireAuth />}>
        <Route path="/onboarding" element={<Onboarding />} />
        <Route element={<RequireOnboarded />}>
          <Route path="/app" element={<AppShell />}>
            <Route index element={<Dashboard />} />
            <Route path="assistant" element={<Assistant />} />
            <Route path="memory" element={<Memory />} />
            <Route path="tasks" element={<Tasks />} />
            <Route path="calendar" element={<Calendar />} />
            <Route path="planner" element={<Planner />} />
            <Route path="notes" element={<Notes />} />
            <Route path="documents" element={<Documents />} />
            <Route path="automations" element={<Automations />} />
            <Route path="insights" element={<Insights />} />
            <Route path="settings" element={<Settings />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
