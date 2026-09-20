/**
 * Sign in.
 *
 * Email/password plus Google. The Google button only renders when the
 * deployment has GOOGLE_CLIENT_ID configured — rather than showing a button
 * that fails when pressed.
 */

import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowLeft, Eye, EyeOff, Loader2, Zap } from 'lucide-react';

import { useAppDispatch, useAppSelector } from '../store';
import { clearError, googleLogin, login } from '../store/authSlice';

/** Minimal shape of the Google Identity Services global we rely on. */
declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize(config: { client_id: string; callback: (r: { credential: string }) => void }): void;
          renderButton(el: HTMLElement, options: Record<string, unknown>): void;
        };
      };
    };
  }
}

export default function Login() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { status, error } = useAppSelector((s) => s.auth);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const googleRef = useRef<HTMLDivElement>(null);
  const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;

  useEffect(() => {
    dispatch(clearError());
  }, [dispatch]);

  // --- Google Identity Services ---
  useEffect(() => {
    if (!googleClientId || !googleRef.current) return;

    const render = () => {
      if (!window.google || !googleRef.current) return;
      window.google.accounts.id.initialize({
        client_id: googleClientId,
        callback: (response) => {
          void dispatch(googleLogin({ credential: response.credential }))
            .unwrap()
            .then(() => navigate('/app/overview', { replace: true }))
            .catch(() => {
              /* the error surfaces through the auth slice */
            });
        },
      });
      window.google.accounts.id.renderButton(googleRef.current, {
        theme: 'filled_black',
        size: 'large',
        width: 320,
        text: 'signin_with',
        shape: 'rectangular',
      });
    };

    if (window.google) {
      render();
      return;
    }

    // Load the SDK only when Google sign-in is actually configured.
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = render;
    document.head.appendChild(script);
    return () => {
      script.onload = null;
    };
  }, [googleClientId, dispatch, navigate]);

  const submitting = status === 'loading';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await dispatch(login({ email, password })).unwrap();
      navigate('/app/overview', { replace: true });
    } catch {
      /* handled by the slice */
    }
  };

  return (
    <AuthShell
      title="Sign in"
      subtitle="Access the GridSync control centre."
      footer={
        <p className="text-xs text-slate-500">
          No account?{' '}
          <Link to="/signup" className="font-medium text-primary-400 hover:text-primary-300">
            Create one
          </Link>
        </p>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
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
          <label htmlFor="email" className="label">Email</label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            autoFocus
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
              autoComplete="current-password"
              className="input pr-10"
              placeholder="••••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
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
        </div>

        <button type="submit" disabled={submitting} className="btn btn-primary w-full">
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
          Sign in
        </button>
      </form>

      {googleClientId ? (
        <>
          <div className="my-6 flex items-center gap-3">
            <span className="h-px flex-1 bg-panel-700" />
            <span className="text-2xs uppercase tracking-wider text-slate-600">or</span>
            <span className="h-px flex-1 bg-panel-700" />
          </div>
          <div ref={googleRef} className="flex justify-center [color-scheme:light]" />
          <p className="mt-3 text-center text-2xs leading-relaxed text-slate-600">
            Google accounts receive the read-only Viewer role unless the address is allowlisted for
            a higher role.
          </p>
        </>
      ) : (
        <p className="mt-6 rounded border border-panel-700 bg-panel-850 p-3 text-2xs leading-relaxed text-slate-500">
          Google sign-in is not configured on this deployment. Set <code className="text-slate-400">GOOGLE_CLIENT_ID</code>,{' '}
          <code className="text-slate-400">GOOGLE_CLIENT_SECRET</code> and{' '}
          <code className="text-slate-400">VITE_GOOGLE_CLIENT_ID</code> to enable it.
        </p>
      )}
    </AuthShell>
  );
}

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-panel-950">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[42vh]"
        style={{
          background:
            'radial-gradient(ellipse 60% 100% at 50% 0%, rgba(2,132,199,0.13), transparent 70%)',
        }}
      />

      <div className="relative flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm">
          <Link
            to="/"
            className="mb-8 inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back
          </Link>

          <div className="mb-7 flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded bg-primary-600">
              <Zap className="h-5 w-5 text-white" strokeWidth={2.5} />
            </div>
            <div>
              <p className="text-base font-semibold leading-none tracking-tight text-slate-100">
                GridSync
              </p>
              <p className="mt-1 text-2xs leading-none text-slate-500">Microgrid Control</p>
            </div>
          </div>

          <h1 className="text-xl font-semibold tracking-tight text-slate-50">{title}</h1>
          <p className="mt-1.5 text-sm text-slate-500">{subtitle}</p>

          <div className="mt-7">{children}</div>

          {footer && <div className="mt-6">{footer}</div>}
        </div>
      </div>
    </div>
  );
}
