import {
  Bot, BookMarked, CalendarDays, CheckSquare, FileText, FolderLock, LayoutDashboard, LineChart, Settings, Sparkles, Workflow, type LucideIcon,
} from 'lucide-react';

export interface NavItem { to: string; label: string; icon: LucideIcon; end?: boolean }

export const NAV: NavItem[] = [
  { to: '/app', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/app/assistant', label: 'AI Assistant', icon: Bot },
  { to: '/app/memory', label: 'My Memory', icon: BookMarked },
  { to: '/app/tasks', label: 'Tasks', icon: CheckSquare },
  { to: '/app/calendar', label: 'Calendar', icon: CalendarDays },
  { to: '/app/planner', label: 'Daily Planner', icon: Sparkles },
  { to: '/app/notes', label: 'Notes', icon: FileText },
  { to: '/app/documents', label: 'Documents', icon: FolderLock },
  { to: '/app/automations', label: 'Automations', icon: Workflow },
  { to: '/app/insights', label: 'Insights', icon: LineChart },
  { to: '/app/settings', label: 'Settings', icon: Settings },
];

/** Five destinations shown in the mobile tab bar; the rest live under "More". */
export const MOBILE_TABS = ['/app', '/app/tasks', '/app/assistant', '/app/calendar'];
