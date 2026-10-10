import { isOffice, requireSession } from '@/auth/session';
import { getPool, withDashboardUser } from '@/db/client';
import { board, dashboardSettings, designers } from '@/crm/queries';
import { Board } from './board';

export default async function PipelinePage({
  searchParams,
}: {
  searchParams: Promise<{ designer?: string; score?: string }>;
}) {
  const session = await requireSession();
  const sp = await searchParams;
  const office = isOffice(session);
  const uuidRe = /^[0-9a-f-]{36}$/i;
  const designerId = office && sp.designer && uuidRe.test(sp.designer) ? sp.designer : null;
  const score = ['hot', 'warm', 'cold'].includes(sp.score ?? '') ? sp.score! : null;

  const [cards, team, settings] = await withDashboardUser(getPool(), session.id, async (tx) =>
    Promise.all([board(tx, { designerId, score }), office ? designers(tx) : Promise.resolve([]), dashboardSettings()]),
  );
  const staleBefore = new Date(Date.now() - settings.staleLeadDays * 86_400_000).toISOString();

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Pipeline</h1>
          <p className="sub">
            Hot leads first. “Going cold” means no activity for {settings.staleLeadDays} days.
          </p>
        </div>
        <form className="filters" method="get" style={{ marginBottom: 0 }}>
          {office ? (
            <div>
              <label htmlFor="designer">Designer</label>
              <select id="designer" name="designer" defaultValue={designerId ?? ''}>
                <option value="">Everyone</option>
                {team.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <div>
            <label htmlFor="score">Score</label>
            <select id="score" name="score" defaultValue={score ?? ''}>
              <option value="">Any</option>
              <option value="hot">Hot</option>
              <option value="warm">Warm</option>
              <option value="cold">Cold</option>
            </select>
          </div>
          <button type="submit">Apply</button>
          {designerId || score ? (
            <a className="btn" href="/pipeline">
              Clear
            </a>
          ) : null}
        </form>
      </div>
      {cards.length === 0 ? (
        <p className="empty">No leads match.</p>
      ) : (
        <Board
          key={`${designerId}-${score}`}
          initial={cards}
          staleBefore={staleBefore}
          avgValueInr={settings.avgProjectValueInr}
          showValue={office}
        />
      )}
    </>
  );
}
