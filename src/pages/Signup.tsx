/**
 * Create account.
 *
 * NO ROLE SELECTOR. The v1 signup form let the user choose their own role and
 * the API trusted it, which meant anyone could register as an administrator.
 * New accounts are Viewer; elevation happens through the server-side allowlist
 * or by an existing administrator.
 *
 * The password policy is shown as live feedback so a user is not rejected by
 * the server for a rule they were never told about.
 */

import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertCircle, Check, Eye, EyeOff, Loader2, X } from 'lucide-react';

import { useAppDispatch, useAppSelector } from '../store';
import { clearError, signup } from '../store/authSlice';
import { AuthShell } from './Login';

/** Mirrors checkPasswordPolicy() in server/auth.ts. */
const RULES: Array<{ label: string; test: (p: string) => boolean }> = [
  { label: 'At least 10 characters', test: (p) => p.length >= 10 },
  { label: 'A lowercase letter', test: (p) => /[a-z]/.test(p) },
  { label: 'An uppercase letter', test: (p) => /[A-Z]/.test(p) },
  { label: 'A digit', test: (p) => /[0-9]/.test(p) },
];

export default function Signup() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { status, error } = useAppSelector((s) => s.auth);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    dispatch(clearError());
  }, [dispatch]);

  const passed = RULES.map((r) => r.test(password));
  const policyOk = passed.every(Boolean);
  const matches = password.length > 0 && password === confirm;
  const canSubmit = name.trim().length >= 2 && email.includes('@') && policyOk && matches;

  const submitting = status === 'loading';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!canSubmit) return;
    try {
      await dispatch(signup({ name: name.trim(), email, password })).unwrap();
      navigate('/app/overview', { replace: true });
    } catch {
      /* handled by the slice */
    }
  };

  return (
    <AuthShell
      title="Create account"
      subtitle="New accounts receive read-only Viewer access."
      footer={
        <p className="text-xs text-slate-500">
          Already registered?{' '}
          <Link to="/login" className="font-medium text-primary-400 hover:text-primary-300">
            Sign in
          </Link>
        </p>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        {error && (
          <div
            className="flex items-start gap-2 rounded border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200"
            role="alert"
          >
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div>
          <label htmlFor="name" className="label">Full name</label>
          <input
            id="name"
            required
            autoComplete="name"
            autoFocus
            className="input"
            placeholder="Arun Thanigaimani"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div>
          <label htmlFor="email" className="label">Email</label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            className="input"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        <div>
          <label htmlFor="password" className="label">Password</label>
          <div className="relative">
            <input
              id="password"
              type={showPassword ? 'text' : 'password'}
              required
              autoComplete="new-password"
              className="input pr-10"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onBlur={() => setTouched(true)}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-slate-500 hover:text-slate-300"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>

          {(touched || password.length > 0) && (
            <ul className="mt-2.5 grid grid-cols-2 gap-1.5">
              {RULES.map((rule, i) => (
                <li
                  key={rule.label}
                  className={`flex items-center gap-1.5 text-2xs ${passed[i] ? 'text-emerald-400' : 'text-slate-600'}`}
                >
                  {passed[i] ? <Check className="h-3 w-3 shrink-0" /> : <X className="h-3 w-3 shrink-0" />}
                  {rule.label}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <label htmlFor="confirm" className="label">Confirm password</label>
          <input
            id="confirm"
            type={showPassword ? 'text' : 'password'}
            required
            autoComplete="new-password"
            className="input"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
          {confirm.length > 0 && !matches && (
            <p className="mt-1.5 text-2xs text-red-400">Passwords do not match.</p>
          )}
        </div>

        <button type="submit" disabled={submitting || !canSubmit} className="btn btn-primary w-full">
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
          Create account
        </button>

        <p className="rounded border border-panel-700 bg-panel-850 p-3 text-2xs leading-relaxed text-slate-500">
          Accounts are created with the <span className="text-slate-300">Viewer</span> role, which
          provides monitoring and analytics but no operational controls. An administrator can grant
          a higher role.
        </p>
      </form>
    </AuthShell>
  );
}
