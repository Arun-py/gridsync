/**
 * Primary navigation.
 *
 * Grouped as CONTROL / MONITORING / INTELLIGENCE / SYSTEM / UTILITY (spec §54).
 *
 * Items are filtered by permission so a Viewer never sees Demo Control. That is
 * presentation only — every route is also guarded, and every privileged API
 * call is checked server-side.
 */

import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Activity,
  BarChart3,
  Battery,
  Bell,
  BrainCircuit,
  Calculator,
  FileText,
  Gauge,
  LayoutDashboard,
  Network,
  Plug,
  Settings,
  SlidersHorizontal,
  Sun,
  Users,
  Zap,
} from 'lucide-react';

import { useAppSelector } from '../store';

interface NavItem {
  to: string;
  labelKey: string;
  icon: typeof LayoutDashboard;
  /** Required permission. Undefined = visible to every signed-in role. */
  permission?: string;
}

interface NavGroup {
  labelKey: string;
  items: NavItem[];
}

const GROUPS: NavGroup[] = [
  {
    labelKey: 'nav.control',
    items: [
      { to: '/app/overview', labelKey: 'nav.overview', icon: LayoutDashboard },
      { to: '/app/microgrid', labelKey: 'nav.microgrid', icon: Network },
    ],
  },
  {
    labelKey: 'nav.monitoring',
    items: [
      { to: '/app/nodes', labelKey: 'nav.nodes', icon: Gauge },
      { to: '/app/solar', labelKey: 'nav.solar', icon: Sun },
      { to: '/app/battery', labelKey: 'nav.battery', icon: Battery },
      { to: '/app/ac-load', labelKey: 'nav.acLoad', icon: Zap },
      { to: '/app/dc-load', labelKey: 'nav.dcLoad', icon: Plug },
    ],
  },
  {
    labelKey: 'nav.intelligence',
    items: [
      { to: '/app/alerts', labelKey: 'nav.alerts', icon: Bell },
      { to: '/app/ai', labelKey: 'nav.ai', icon: BrainCircuit, permission: 'view:ai' },
      { to: '/app/analytics', labelKey: 'nav.analytics', icon: BarChart3, permission: 'view:analytics' },
    ],
  },
  {
    labelKey: 'nav.system',
    items: [
      { to: '/app/health', labelKey: 'nav.health', icon: Activity },
      {
        to: '/app/demo',
        labelKey: 'nav.demo',
        icon: SlidersHorizontal,
        permission: 'simulation:control',
      },
      { to: '/app/users', labelKey: 'nav.users', icon: Users, permission: 'users:manage' },
      { to: '/app/settings', labelKey: 'nav.settings', icon: Settings },
    ],
  },
  {
    labelKey: 'nav.utility',
    items: [
      { to: '/app/bill', labelKey: 'nav.bill', icon: Calculator },
      { to: '/app/reports', labelKey: 'nav.reports', icon: FileText, permission: 'reports:generate' },
    ],
  },
];

export default function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useTranslation();
  const permissions = useAppSelector((s) => s.auth.permissions);
  const user = useAppSelector((s) => s.auth.user);

  const visible = (item: NavItem) => !item.permission || permissions.includes(item.permission);

  return (
    <nav className="flex h-full flex-col overflow-y-auto px-2 pb-4" aria-label="Main navigation">
      {GROUPS.map((group) => {
        const items = group.items.filter(visible);
        // Hide a group entirely if the role can see none of it, rather than
        // leaving an orphaned heading.
        if (items.length === 0) return null;

        return (
          <div key={group.labelKey}>
            <p className="nav-group-label">{t(group.labelKey)}</p>
            <ul className="space-y-0.5">
              {items.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    onClick={onNavigate}
                    className={({ isActive }) => `nav-link ${isActive ? 'nav-link-active' : ''}`}
                  >
                    <item.icon className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                    <span className="truncate">{t(item.labelKey)}</span>
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        );
      })}

      {user?.role === 'VIEWER' && (
        <div className="mx-2 mt-6 rounded border border-panel-700 bg-panel-850 p-3">
          <p className="text-2xs font-semibold uppercase tracking-wider text-slate-500">
            Read-only access
          </p>
          <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
            Your Viewer role provides monitoring and analytics. Operational controls are not
            available.
          </p>
        </div>
      )}
    </nav>
  );
}
