import type { MouseEvent } from 'react';
import s from './shared.module.css';

interface Props {
  done: boolean;
  onToggle: () => void;
  size?: 'task' | 'sub';
  label: string;
}

export function Checkbox({ done, onToggle, size = 'task', label }: Props) {
  function handleClick(e: MouseEvent) {
    e.stopPropagation();
    onToggle();
  }
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={done}
      aria-label={label}
      onClick={handleClick}
      className={`${size === 'sub' ? s.subCheckbox : s.checkbox} ${done ? s.done : ''}`}
    >
      {done ? '✓' : ''}
    </button>
  );
}
