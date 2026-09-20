/**
 * User Management (Administrator only).
 *
 * Role changes are applied server-side and audited. An administrator cannot
 * demote themselves — otherwise a single mis-click could lock every admin out
 * of the deployment.
 */

import { useEffect, useState } from 'react';
import { RefreshCw, ShieldCheck, Users } from 'lucide-react';

import type { Role, User } from '@shared/types';
import { EmptyState, ErrorState, LoadingState, Panel, fmtDateTime } from '../components/ui';
import { errorMessage, usersApi } from '../lib/api';
import { useAppSelector } from '../store';

const ROLES: Role[] = ['ADMIN', 'OPERATOR', 'TECHNICIAN', 'VIEWER'];

const ROLE_SUMMARY: Record<Role, string> = {
  ADMIN: 'Full access: user management, settings, simulator control, all analytics.',
  OPERATOR: 'Dashboard, alerts (acknowledge and resolve), simulator control, reports.',
  TECHNICIAN: 'Diagnostics, maintenance intelligence, historical telemetry, acknowledge alerts.',
  VIEWER: 'Read-only monitoring and analytics. No operational controls.',
};

export default function UserManagement() {
  const currentUser = useAppSelector((s) => s.auth.user);

  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    usersApi
      .list()
      .then((data) => {
        setUsers(data.users);
        setError(null);
      })
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const changeRole = async (user: User, role: Role) => {
    if (role === user.role) return;
    setBusyId(user.id);
    setActionError(null);
    try {
      await usersApi.setRole(user.id, role);
      setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, role } : u)));
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-slate-50">
            <Users className="h-5 w-5 text-slate-400" strokeWidth={1.75} />
            User Management
          </h1>
          <p className="mt-1 text-xs text-slate-500">
            {users.length} account(s). Role changes take effect on the user's next request.
          </p>
        </div>
        <button onClick={load} className="btn btn-secondary btn-sm">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {actionError && <ErrorState title="Could not change role" message={actionError} variant="warning" />}

      {loading && users.length === 0 ? (
        <Panel><LoadingState /></Panel>
      ) : error ? (
        <ErrorState message={error} onRetry={load} />
      ) : users.length === 0 ? (
        <Panel>
          <EmptyState title="No accounts" description="No users have registered yet." />
        </Panel>
      ) : (
        <Panel bodyClassName="">
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Provider</th>
                  <th>Created</th>
                  <th>Role</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => {
                  const isSelf = user.id === currentUser?.id;
                  return (
                    <tr key={user.id}>
                      <td>
                        <span className="font-medium text-slate-200">{user.name}</span>
                        {isSelf && <span className="ml-2 badge badge-neutral">You</span>}
                        {user.mustChangePassword && (
                          <span className="ml-2 badge badge-warning">Seeded</span>
                        )}
                      </td>
                      <td className="text-xs text-slate-400">{user.email}</td>
                      <td className="text-xs text-slate-500">{user.provider}</td>
                      <td className="text-xs text-slate-500">{fmtDateTime(user.createdAt)}</td>
                      <td>
                        <select
                          className="select w-auto text-xs"
                          value={user.role}
                          disabled={busyId === user.id || isSelf}
                          onChange={(e) => void changeRole(user, e.target.value as Role)}
                          aria-label={`Role for ${user.email}`}
                          title={
                            isSelf
                              ? 'You cannot change your own role'
                              : `Change role for ${user.email}`
                          }
                        >
                          {ROLES.map((role) => (
                            <option key={role} value={role}>
                              {role}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="px-4 pb-4 pt-3 text-2xs leading-relaxed text-slate-600">
            You cannot change your own role. Ask another administrator if you need yours altered.
            Every role change is recorded in the system event log.
          </p>
        </Panel>
      )}

      {/* ---- role reference ---- */}
      <Panel
        title="Roles"
        subtitle="Enforced server-side on every request"
        actions={<ShieldCheck className="h-4 w-4 text-emerald-400" />}
      >
        <dl className="grid gap-3 sm:grid-cols-2">
          {ROLES.map((role) => (
            <div key={role} className="rounded border border-panel-700 bg-panel-850 p-3">
              <dt className="text-xs font-semibold text-slate-200">{role}</dt>
              <dd className="mt-1.5 text-2xs leading-relaxed text-slate-500">
                {ROLE_SUMMARY[role]}
              </dd>
            </div>
          ))}
        </dl>

        <p className="mt-4 border-t border-panel-800 pt-3 text-2xs leading-relaxed text-slate-600">
          Google-authenticated users receive VIEWER unless their address appears in the
          ADMIN_EMAILS, OPERATOR_EMAILS or TECHNICIAN_EMAILS environment allowlists. Privileged
          addresses are never hardcoded in source, and the role is re-evaluated at every sign-in.
        </p>
      </Panel>
    </div>
  );
}
