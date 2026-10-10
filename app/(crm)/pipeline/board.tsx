'use client';
import { useState, useTransition } from 'react';
import { LEAD_STAGES, STAGE_LABELS, type LeadStage } from '@/core/crm';
import type { BoardCard } from '@/crm/queries';
import { moveStage } from '../../actions';

const ACTIVE = new Set<LeadStage>(['qualified', 'consultation_booked', 'consultation_done', 'proposal_sent']);
const SCORE_TONE = { hot: 'hot', warm: 'warn', cold: '' } as const;

export function Board({
  initial,
  staleBefore,
  avgValueInr,
  showValue,
}: {
  initial: BoardCard[];
  staleBefore: string;
  avgValueInr: number;
  showValue: boolean;
}) {
  const [cards, setCards] = useState(initial);
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<LeadStage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function drop(stage: LeadStage) {
    const id = dragId;
    setOver(null);
    setDragId(null);
    if (id) move(id, stage);
  }

  function move(id: string, stage: LeadStage) {
    const card = cards.find((c) => c.id === id);
    if (!card || card.stage === stage) return;
    let reason: string | undefined;
    if (stage === 'lost') {
      reason = window.prompt(`Why was ${card.name ?? card.phone} lost?`)?.trim();
      if (!reason) return;
    }
    const before = cards;
    setCards(cards.map((c) => (c.id === id ? { ...c, stage, lostReason: reason ?? c.lostReason } : c)));
    setError(null);
    startTransition(async () => {
      const r = await moveStage(card.id, stage, reason);
      if (!r.ok) {
        setCards(before);
        setError(r.error);
      }
    });
  }

  const fmtValue = (n: number) => `₹${(n / 1_00_000).toFixed(0)} L`;

  return (
    <>
      {error ? <div className="flash error" role="alert">{error}</div> : null}
      <p className="sub" style={{ marginBottom: 12 }}>
        Drag a card to another stage, or use its “Move to” menu. {pending ? 'Saving…' : ''}
      </p>
      <div className="board">
        {LEAD_STAGES.map((stage) => {
          const inStage = cards.filter((c) => c.stage === stage);
          return (
            <section
              key={stage}
              className={`column ${over === stage ? 'drop' : ''}`}
              aria-label={STAGE_LABELS[stage]}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(stage);
              }}
              onDragLeave={() => setOver((o) => (o === stage ? null : o))}
              onDrop={(e) => {
                e.preventDefault();
                drop(stage);
              }}
            >
              <div className="column-head">
                <span className="t">{STAGE_LABELS[stage]}</span>
                <span className="n">
                  {inStage.length}
                  {showValue && ACTIVE.has(stage) && inStage.length ? ` · ${fmtValue(inStage.length * avgValueInr)}` : ''}
                </span>
              </div>
              {inStage.map((c) => {
                const stale = ACTIVE.has(c.stage) && c.lastActivityAt < staleBefore;
                return (
                  <article
                    key={c.id}
                    className={`lead-card ${dragId === c.id ? 'moving' : ''}`}
                    draggable
                    onDragStart={() => setDragId(c.id)}
                    onDragEnd={() => setDragId(null)}
                  >
                    <a className="name" href={`/leads/${c.id}`}>
                      {c.name ?? c.phone}
                    </a>
                    <div className="meta">
                      {[c.area, c.sizeSqft ? `${c.sizeSqft.toLocaleString('en-IN')} sq ft` : null].filter(Boolean).join(' · ') || 'Area not given'}
                    </div>
                    {c.scope ? <div className="meta">{c.scope}</div> : null}
                    {c.stage === 'lost' && c.lostReason ? <div className="meta">Lost: {c.lostReason}</div> : null}
                    <div className="tags">
                      {c.score ? (
                        <span className={`badge ${SCORE_TONE[c.score]}`} title={c.scoreReasons.join('\n')}>
                          {c.score}
                        </span>
                      ) : null}
                      {c.designerName ? <span className="badge accent">{c.designerName}</span> : ACTIVE.has(c.stage) ? <span className="badge warn">No designer</span> : null}
                      {stale ? <span className="badge bad">Going cold</span> : null}
                      {c.openComplaint ? <span className="badge bad">Open complaint</span> : null}
                      {c.openTasks ? <span className="badge">{c.openTasks} task{c.openTasks > 1 ? 's' : ''}</span> : null}
                    </div>
                    <select
                      className="move"
                      aria-label={`Move ${c.name ?? c.phone} to`}
                      value=""
                      onChange={(e) => e.target.value && move(c.id, e.target.value as LeadStage)}
                    >
                      <option value="">Move to…</option>
                      {LEAD_STAGES.filter((s) => s !== c.stage).map((s) => (
                        <option key={s} value={s}>
                          {STAGE_LABELS[s]}
                        </option>
                      ))}
                    </select>
                  </article>
                );
              })}
            </section>
          );
        })}
      </div>
    </>
  );
}
