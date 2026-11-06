'use client';
// /login — the one account gate. First visit flips into setup mode: the
// credentials entered here CREATE the owner account (stored scrypt-hashed in
// the local SQLite users table). After that this is a plain sign-in form.
// The session is an httpOnly cookie; everything else is gated by proxy.ts.
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Logo } from '@/components/logo';
import { BRAND } from '@/lib/brand';
import { btnPrimary, inputCls, labelCls } from '@/components/panel';
import { KeyRound, ShieldCheck } from 'lucide-react';
import { Spinner } from '@/components/panelui/spinner';

type Mode = null | 'setup' | 'signin';

export default function Login() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch('/api/auth').then(r => r.json()).then((j: { hasUser?: boolean }) => setMode(j.hasUser ? 'signin' : 'setup')).catch(() => setMode('signin'));
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setErr(null);
    setBusy(true);
    try {
      const r = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: mode === 'setup' ? 'register' : 'signin', username, password }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErr(j?.error || (r.status === 401 ? 'Wrong username or password.' : `Sign-in failed (${r.status}).`));
        // owner already registered in another tab → fall back to the sign-in form
        if (mode === 'setup' && /already exists/i.test(j?.error || '')) setMode('signin');
        setBusy(false);
        return;
      }
      router.replace('/');
      router.refresh();
    } catch {
      setErr('The app did not answer — is `npm run dev` running?');
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-7 flex flex-col items-center gap-3 text-center">
          <Logo />
          <p className="text-[13px] text-muted-foreground leading-relaxed">
            {mode === 'setup'
              ? 'First run: create the one local account. Credentials live ONLY in this machine\'s SQLite (scrypt-hashed).'
              : BRAND.slogan}
          </p>
        </div>

        <form onSubmit={submit} className="rounded-xl border border-border bg-card p-5 shadow-none">
          <h1 className="text-sm font-semibold tracking-tight">{mode === 'setup' ? 'Create your account' : 'Sign in'}</h1>
          <div className="mt-4 space-y-3">
            <div>
              <label htmlFor="lu" className={labelCls}>Username</label>
              <input id="lu" className={inputCls} value={username} onChange={e => setUsername(e.target.value)}
                autoComplete="username" autoFocus required placeholder="e.g. you" />
            </div>
            <div>
              <label htmlFor="lp" className={labelCls}>Password</label>
              <input id="lp" type="password" className={inputCls} value={password} onChange={e => setPassword(e.target.value)}
                autoComplete={mode === 'setup' ? 'new-password' : 'current-password'} required
                placeholder={mode === 'setup' ? 'at least 6 characters' : '••••••••'} />
            </div>
          </div>
          {err && <p role="alert" className="mt-3 text-[13px] text-foreground font-medium">{err}</p>}
          <button type="submit" disabled={busy || mode == null} className={btnPrimary + ' mt-4 w-full justify-center'}>
            {busy ? <Spinner className="size-4" />
              : mode === 'setup' ? <><KeyRound className="size-4" aria-hidden="true" />Create account & sign in</>
              : <>Sign in</>}
          </button>
        </form>

        <p className="mt-4 flex items-start gap-1.5 text-[11px] leading-snug text-muted-foreground">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          One owner account, no email, no third-party auth. Everything stays local; signing out appears in the sidebar.
        </p>
      </div>
    </div>
  );
}
