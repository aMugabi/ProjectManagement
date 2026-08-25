import s from './shared.module.css';

export function ProgressBar({
  percent,
  color,
  thin = false,
}: {
  percent: number;
  color: string;
  thin?: boolean;
}) {
  return (
    <div
      className={`${s.progressTrack} ${thin ? s.thin : ''}`}
      role="progressbar"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className={s.progressFill} style={{ width: `${percent}%`, background: color }} />
    </div>
  );
}
