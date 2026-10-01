import { useState, type FormEvent, type ReactNode } from 'react';
import { checkPassword, isUnlocked } from '../lib/auth';
import { useTaskStore } from '../store/taskStore';
import s from './LoginGate.module.css';

export function LoginGate({ children }: { children: ReactNode }) {
  const [unlocked, setUnlocked] = useState(isUnlocked);
  const [password, setPassword] = useState('');
  const [error, setError] = useState(false);
  const [checking, setChecking] = useState(false);

  if (unlocked) return <>{children}</>;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setChecking(true);
    const ok = await checkPassword(password);
    setChecking(false);
    if (ok) {
      setUnlocked(true);
      // The store rehydrated from local cache before login (no token yet) —
      // now that we have one, pull the latest cloud copy.
      useTaskStore.persist.rehydrate();
    } else {
      setError(true);
      setPassword('');
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
          placeholder="Password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            setError(false);
          }}
        />
        {error && <div className={s.error}>Incorrect password</div>}
        <button type="submit" className={s.button} disabled={checking || !password}>
          {checking ? 'Checking…' : 'Unlock'}
        </button>
      </form>
    </div>
  );
}
