import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { isUnlocked, login, SIGNED_OUT_EVENT, type LoginResult } from '../lib/auth';
import { useTaskStore } from '../store/taskStore';
import s from './LoginGate.module.css';

const ERRORS: Record<Exclude<LoginResult, 'ok'>, string> = {
  incorrect: 'Incorrect password',
  'rate-limited': 'Too many attempts — try again in a few minutes',
  unavailable: "Can't reach Ledger's server — check your connection",
};

/** Cloud builds only (see main.tsx): the password is checked server-side before any data is served. */
export function LoginGate({ children }: { children: ReactNode }) {
  const [unlocked, setUnlocked] = useState(isUnlocked);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  // Lock again if the server rejects the session (expired, or signed out on another device).
  useEffect(() => {
    const lock = () => setUnlocked(false);
    window.addEventListener(SIGNED_OUT_EVENT, lock);
    return () => window.removeEventListener(SIGNED_OUT_EVENT, lock);
  }, []);

  if (unlocked) return <>{children}</>;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setChecking(true);
    const result = await login(password);
    setChecking(false);
    if (result === 'ok') {
      setUnlocked(true);
      setPassword('');
      // The store rehydrated from local cache before login (no token yet) —
      // now that we have one, pull and merge the latest cloud copy.
      void useTaskStore.persist.rehydrate();
    } else {
      setError(ERRORS[result]);
      if (result === 'incorrect') setPassword('');
    }
  }

  return (
    <div className={s.scrim}>
      <form className={s.dialog} onSubmit={handleSubmit}>
        <div className={s.mark} />
        <div className={s.title}>Ledger</div>
        <input
          className={s.input}
          type="password"
          autoFocus
          autoComplete="current-password"
          placeholder="Password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            setError(null);
          }}
        />
        {error && <div className={s.error}>{error}</div>}
        <button type="submit" className={s.button} disabled={checking || !password}>
          {checking ? 'Checking…' : 'Unlock'}
        </button>
      </form>
    </div>
  );
}
