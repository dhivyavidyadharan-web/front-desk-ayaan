// Small shared presentational pieces.
import type { ReactNode } from 'react';

export function Flash({ sp }: { sp: Record<string, string | undefined> }) {
  if (sp.error) return <div className="flash error" role="alert">{sp.error}</div>;
  if (sp.msg) return <div className="flash ok" role="status">{sp.msg}</div>;
  return null;
}

export function Metric({
  k,
  v,
  s,
  href,
  tone,
}: {
  k: string;
  v: ReactNode;
  s?: ReactNode;
  href?: string;
  tone?: 'good' | 'alert';
}) {
  const body = (
    <>
      <div className="k">{k}</div>
      <div className="v">{v}</div>
      {s ? <div className="s">{s}</div> : null}
    </>
  );
  return href ? (
    <a className={`metric ${tone ?? ''}`} href={href}>
      {body}
    </a>
  ) : (
    <div className={`metric ${tone ?? ''}`}>{body}</div>
  );
}

const SCORE_TONE = { hot: 'hot', warm: 'warn', cold: '' } as const;
export function ScoreBadge({ score, reasons }: { score: 'hot' | 'warm' | 'cold' | null; reasons?: string[] }) {
  if (!score) return null;
  return (
    <span className={`badge ${SCORE_TONE[score]}`} title={reasons?.join('\n')}>
      {score}
    </span>
  );
}

const OUTCOME_TONE: Record<string, string> = {
  qualified: 'ok',
  declined: '',
  unsure: 'warn',
  escalate_complaint: 'bad',
  missed: '',
};
export function OutcomeBadge({ outcome, label }: { outcome: string | null; label: string }) {
  return <span className={`badge ${outcome ? (OUTCOME_TONE[outcome] ?? '') : 'warn'}`}>{label}</span>;
}
