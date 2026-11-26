import { useEffect, useState, useSyncExternalStore, type FormEvent, type ReactNode } from 'react';
import { isUnlocked, login, mfaRequired, subscribeAuth, type LoginResult } from '../lib/auth';
import { useTaskStore } from '../store/taskStore';
import s from './LoginGate.module.css';

const ERRORS: Record<Exclude<LoginResult, 'ok'>, string> = {
  incorrect: 'Incorrect password',
  'rate-limited': 'Too many attempts — try again in a few minutes',
  unavailable: "Can't reach Ledger's server — check your connection",
};

/** Cloud builds only (see main.tsx): the password is checked server-side before any data is served. */
export function LoginGate({ children }: { children: ReactNode }) {
  // Locks again whenever the session goes away (expired, or signed out on another device).
  const unlocked = useSyncExternalStore(subscribeAuth, isUnlocked);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  // Whether the server asks for an authenticator code too; null = not known (offline): offer it anyway.
  const [mfa, setMfa] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (unlocked) return;
    let live = true;
    void mfaRequired().then((required) => live && setMfa(required));
    return () => {
      live = false;
    };
  }, [unlocked]);

  if (unlocked) return <>{children}</>;

  const askCode = mfa !== false;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setChecking(true);
    const result = await login(password, askCode ? code.trim() : undefined);
    setChecking(false);
    if (result === 'ok') {
      setPassword('');
      setCode('');
      // The store rehydrated from local cache before login (no token yet) —
      // now that we have one, pull and merge the latest cloud copy.
      void useTaskStore.persist.rehydrate();
    } else {
      setError(result === 'incorrect' && askCode ? 'Incorrect password or code' : ERRORS[result]);
      if (result === 'incorrect') {
        setPassword('');
        setCode('');
      }
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
        {askCode && (
          <>
            <input
              className={`${s.input} ${s.code}`}
              type="text"
              inputMode="text"
              autoComplete="one-time-code"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="Authenticator code"
              aria-label="Authenticator code"
              value={code}
              onChange={(e) => {
                setCode(e.target.value);
                setError(null);
              }}
            />
            <div className={s.hint}>The 6-digit code from your authenticator app, or a recovery code</div>
          </>
        )}
        {error && <div className={s.error}>{error}</div>}
        <button type="submit" className={s.button} disabled={checking || !password || (mfa === true && !code.trim())}>
          {checking ? 'Checking…' : 'Unlock'}
        </button>
      </form>
    </div>
  );
}
