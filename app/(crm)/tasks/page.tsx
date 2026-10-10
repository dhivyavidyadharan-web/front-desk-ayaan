import Link from 'next/link';
import { requireSession } from '@/auth/session';
import { getPool, withDashboardUser } from '@/db/client';
import { tasksList, type TaskView } from '@/crm/queries';
import { TASK_TYPE_LABELS, fmtDateTime, label } from '@/crm/labels';
import { completeTask } from '../../actions';
import { Flash } from '../../ui';

const VIEWS: { v: TaskView; label: string }[] = [
  { v: 'open', label: 'All open' },
  { v: 'mine', label: 'Mine' },
  { v: 'done', label: 'Done' },
];

export default async function TasksPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await requireSession();
  const sp = await searchParams;
  const view: TaskView = VIEWS.find((x) => x.v === sp.view)?.v ?? 'open';
  const rows = await withDashboardUser(getPool(), session.id, (tx) => tasksList(tx, view, session.id));
  const now = Date.now();

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Tasks</h1>
          <p className="sub">Call-back reminders, open questions, complaints and follow-ups. Overdue first.</p>
        </div>
        <nav className="segmented" aria-label="View">
          {VIEWS.map((x) => (
            <Link key={x.v} href={`/tasks?view=${x.v}`} className={x.v === view ? 'active' : undefined}>
              {x.label}
            </Link>
          ))}
        </nav>
      </div>
      <Flash sp={sp} />
      {rows.length === 0 ? (
        <p className="empty">{view === 'done' ? 'Nothing completed yet.' : 'All clear.'}</p>
      ) : (
        <table className="list">
          <thead>
            <tr>
              <th>Type</th>
              <th>Task</th>
              <th>Lead</th>
              <th>{view === 'done' ? 'Finished' : 'Due'}</th>
              <th>For</th>
              {view === 'done' ? null : <th />}
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => {
              const overdue = view !== 'done' && t.due_at !== null && new Date(t.due_at).getTime() < now;
              return (
                <tr key={t.id} className={overdue ? 'overdue' : undefined}>
                  <td>
                    <span className={`badge ${t.type === 'complaint' ? 'bad' : t.type === 'callback' ? 'warn' : ''}`}>{label(TASK_TYPE_LABELS, t.type)}</span>
                  </td>
                  <td>
                    {t.title ?? '—'}
                    {t.question ? <div className="sub">{t.question}</div> : null}
                    {view === 'done' && t.status === 'cancelled' ? <div className="sub">Cancelled automatically (caller rang back)</div> : null}
                  </td>
                  <td>{t.enquiry_id ? <Link href={`/leads/${t.enquiry_id}`}>{t.name ?? t.phone}</Link> : '—'}</td>
                  <td>
                    {fmtDateTime(view === 'done' ? t.resolved_at : t.due_at)}
                    {overdue ? <div><span className="badge bad">overdue</span></div> : null}
                  </td>
                  <td>{t.assignee ?? 'Front desk'}</td>
                  {view === 'done' ? null : (
                    <td>
                      <form action={completeTask}>
                        <input type="hidden" name="taskId" value={t.id} />
                        <input type="hidden" name="returnTo" value={`/tasks?view=${view}`} />
                        <button type="submit">Done</button>
                      </form>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}
