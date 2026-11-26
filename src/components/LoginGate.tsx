import { useEffect, useState, useSyncExternalStore, type FormEvent, type ReactNode } from 'react';
import { isUnlocked, login, loginOptions, subscribeAuth, type LoginOptions, type LoginResult } from '../lib/auth';
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
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  // What the server asks for; null = not known (offline): offer the code field anyway.
  const [options, setOptions] = useState<LoginOptions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (unlocked) return;
    let live = true;
    void loginOptions().then((o) => live && setOptions(o));
    return () => {
      live = false;
    };
  }, [unlocked]);

  if (unlocked) return <>{children}</>;

  const mfa = options?.mfa ?? null;
  const askCode = mfa !== false;
  const askEmail = options?.email === true;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setChecking(true);
    const result = await login(password, askCode ? code.trim() : undefined, askEmail ? email.trim() : undefined);
    setChecking(false);
    if (result === 'ok') {
      setPassword('');
      setCode('');
      // The store rehydrated from local cache before login (no token yet) —
      // now that we have one, pull and merge the latest cloud copy.
      void useTaskStore.persist.rehydrate();
    } else {
      const incorrect = askEmail ? 'Incorrect email, password or code' : askCode ? 'Incorrect password or code' : ERRORS.incorrect;
      setError(result === 'incorrect' ? incorrect : ERRORS[result]);
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
        {askEmail && (
          <input
            className={`${s.input} ${s.email}`}
            type="email"
            autoFocus
            autoComplete="username"
            placeholder="Email"
            aria-label="Email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setError(null);
            }}
          />
        )}
        <input
          className={s.input}
          type="password"
          autoFocus={!askEmail}
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
        <button
          type="submit"
          className={s.button}
          disabled={checking || !password || (mfa === true && !code.trim()) || (askEmail && !email.trim())}
        >
          {checking ? 'Checking…' : 'Unlock'}
        </button>
      </form>
    </div>
  );
}
