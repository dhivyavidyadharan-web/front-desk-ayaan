'use server';
// Every dashboard button posts to one of these. Writes run as the signed-in staff member, so
// the database's RLS policies decide what is allowed; a blocked write comes back as an error.
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { VIEW_AS_COOKIE, requireSession, type StaffSession } from '@/auth/session';
import { LEAD_STAGES, STAGE_LABELS, type LeadStage } from '@/core/crm';
import { getPool, withDashboardUser, type Tx } from '@/db/client';

const uuid = z.guid();

function back(path: string, params: Record<string, string>): never {
  const qs = new URLSearchParams(params).toString();
  redirect(`${path}${qs ? `${path.includes('?') ? '&' : '?'}${qs}` : ''}`);
}

async function asUser<T>(session: StaffSession, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withDashboardUser(getPool(), session.id, fn);
}

async function logActivity(tx: Tx, s: StaffSession, enquiryId: string, kind: string, body: string) {
  await tx.query(
    `insert into public.activities (enquiry_id, staff_id, author_name, kind, body)
     values ($1, $2, $3, $4::public.activity_kind, $5)`,
    [enquiryId, s.id, s.displayName, kind, body],
  );
  await tx.query(`update public.enquiries set last_activity_at = now() where id = $1`, [enquiryId]);
}

// ---------------------------------------------------------------------------
// "Viewing as" (no login: demo project)
// ---------------------------------------------------------------------------

export async function viewAs(formData: FormData) {
  const id = uuid.safeParse(formData.get('staffId'));
  const returnTo = String(formData.get('returnTo') ?? '/');
  const safeReturn = returnTo.startsWith('/') && !returnTo.startsWith('//') && !returnTo.startsWith('/leads/') ? returnTo : '/';
  if (id.success) (await cookies()).set(VIEW_AS_COOKIE, id.data, { httpOnly: true, sameSite: 'lax', path: '/' });
  redirect(safeReturn);
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

export type ActionResult = { ok: true } | { ok: false; error: string };

/** Used by the drag-and-drop board and the stage form on the lead page. */
export async function moveStage(enquiryId: string, stage: string, lostReason?: string): Promise<ActionResult> {
  const session = await requireSession();
  if (!uuid.safeParse(enquiryId).success) return { ok: false, error: 'Unknown lead.' };
  if (!(LEAD_STAGES as readonly string[]).includes(stage)) return { ok: false, error: 'Unknown stage.' };
  const reason = lostReason?.trim() ?? '';
  if (stage === 'lost' && !reason) return { ok: false, error: 'Say why the lead was lost.' };

  const result = await asUser(session, async (tx): Promise<ActionResult> => {
    const cur = await tx.query<{ stage: LeadStage | null }>(`select stage from public.enquiries where id = $1`, [enquiryId]);
    const from = cur.rows[0]?.stage;
    if (from === undefined) return { ok: false, error: 'Lead not found.' };
    if (from === stage) return { ok: true };
    const upd = await tx.query(
      `update public.enquiries set stage = $2::public.lead_stage, stage_changed_at = now(),
         lost_reason = case when $2::text = 'lost' then $3 else lost_reason end
       where id = $1`,
      [enquiryId, stage, reason || null],
    );
    if (upd.rowCount === 0) return { ok: false, error: 'You can only move leads assigned to you.' };
    await logActivity(
      tx,
      session,
      enquiryId,
      'stage_change',
      `Stage: ${from ? STAGE_LABELS[from] : 'none'} → ${STAGE_LABELS[stage as LeadStage]}${stage === 'lost' ? ` (${reason})` : ''}.`,
    );
    return { ok: true };
  });
  revalidatePath('/pipeline');
  revalidatePath(`/leads/${enquiryId}`);
  revalidatePath('/');
  return result;
}

export async function moveStageForm(formData: FormData) {
  const id = String(formData.get('enquiryId'));
  const r = await moveStage(id, String(formData.get('stage')), String(formData.get('lostReason') ?? ''));
  back(`/leads/${id}`, r.ok ? { msg: 'Stage updated.' } : { error: r.error });
}

export async function assignDesigner(formData: FormData) {
  const session = await requireSession();
  const enquiryId = uuid.safeParse(formData.get('enquiryId'));
  const designerId = uuid.safeParse(formData.get('designerId'));
  if (!enquiryId.success || !designerId.success) back('/pipeline', { error: 'Pick a designer.' });
  const path = `/leads/${enquiryId.data}`;
  const error = await asUser(session, async (tx) => {
    const d = await tx.query<{ name: string }>(`select name from public.designers where id = $1 and active`, [designerId.data]);
    if (!d.rows[0]) return 'Designer not found.';
    const upd = await tx.query(`update public.enquiries set assigned_designer_id = $2 where id = $1`, [enquiryId.data, designerId.data]);
    if (upd.rowCount === 0) return 'Only admin or front desk can reassign leads.';
    await logActivity(tx, session, enquiryId.data, 'assignment', `Assigned to ${d.rows[0].name} by ${session.displayName}.`);
    return null;
  }).catch(() => 'Only admin or front desk can reassign leads.');
  revalidatePath('/pipeline');
  back(path, error ? { error } : { msg: 'Designer assigned.' });
}

export async function addNote(formData: FormData) {
  const session = await requireSession();
  const enquiryId = uuid.safeParse(formData.get('enquiryId'));
  const body = String(formData.get('body') ?? '').trim();
  if (!enquiryId.success) back('/pipeline', { error: 'Unknown lead.' });
  const path = `/leads/${enquiryId.data}`;
  if (!body) back(path, { error: 'Write a note first.' });
  if (body.length > 2000) back(path, { error: 'Keep notes under 2,000 characters.' });
  const error = await asUser(session, async (tx) => {
    await logActivity(tx, session, enquiryId.data, 'note', body);
    return null;
  }).catch(() => 'You can only add notes to your own leads.');
  back(path, error ? { error } : { msg: 'Note added.' });
}

export async function addReminder(formData: FormData) {
  const session = await requireSession();
  const enquiryId = uuid.safeParse(formData.get('enquiryId'));
  if (!enquiryId.success) back('/pipeline', { error: 'Unknown lead.' });
  const path = `/leads/${enquiryId.data}`;
  const title = String(formData.get('title') ?? '').trim();
  const due = String(formData.get('due') ?? '');
  const assignee = uuid.safeParse(formData.get('assignee'));
  if (!title) back(path, { error: 'Say what needs doing.' });
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(due)) back(path, { error: 'Pick a due date and time.' });
  if (!assignee.success) back(path, { error: 'Pick who it is for.' });
  const dueAt = new Date(`${due}:00+05:30`); // the form's local time is studio time

  const error = await asUser(session, async (tx) => {
    const who = await tx.query<{ display_name: string | null; email: string }>(
      `select display_name, email from public.staff where id = $1 and active`,
      [assignee.data],
    );
    const name = who.rows[0]?.display_name ?? who.rows[0]?.email;
    if (!name) return 'You can only set reminders for yourself.';
    await tx.query(
      `insert into public.tasks (type, enquiry_id, title, due_at, assigned_to) values ('follow_up', $1, $2, $3, $4)`,
      [enquiryId.data, title, dueAt, assignee.data],
    );
    await logActivity(tx, session, enquiryId.data, 'task', `Reminder for ${name}: ${title} (due ${due.replace('T', ' ')}).`);
    return null;
  }).catch(() => 'You can only set reminders for yourself on your own leads.');
  revalidatePath('/tasks');
  back(path, error ? { error } : { msg: 'Reminder added.' });
}

export async function completeTask(formData: FormData) {
  const session = await requireSession();
  const taskId = uuid.safeParse(formData.get('taskId'));
  const returnTo = String(formData.get('returnTo') ?? '/tasks');
  const safeReturn = returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/tasks';
  if (!taskId.success) back(safeReturn, { error: 'Unknown task.' });
  const error = await asUser(session, async (tx) => {
    const upd = await tx.query<{ enquiry_id: string | null; title: string | null; type: string }>(
      `update public.tasks set status = 'done', resolved_by = $2, resolved_at = now()
        where id = $1 and status in ('open','in_progress')
        returning enquiry_id, title, type::text`,
      [taskId.data, session.id],
    );
    const t = upd.rows[0];
    if (!t) return 'That task is already done or not yours.';
    if (t.enquiry_id) await logActivity(tx, session, t.enquiry_id, 'task', `Done: ${t.title ?? t.type}.`);
    return null;
  }).catch(() => 'That task is not yours to complete.');
  revalidatePath('/tasks');
  revalidatePath('/');
  back(safeReturn, error ? { error } : { msg: 'Marked done.' });
}

// ---------------------------------------------------------------------------
// Settings (admin only; enforced by RLS)
// ---------------------------------------------------------------------------

export async function updateConfig(formData: FormData) {
  const session = await requireSession();
  const key = String(formData.get('key') ?? '');
  const raw = String(formData.get('value') ?? '').trim();
  const confirmed = formData.get('confirmed') === 'on';
  if (session.role !== 'admin') back('/settings', { error: 'Only admin can change settings.' });

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    back('/settings', { error: `${key}: not valid. Numbers as 6, lists as ["a","b"], text in "quotes".` });
  }
  const error = await asUser(session, async (tx) => {
    const cur = await tx.query<{ value: unknown }>(`select value from public.config where key = $1`, [key]);
    if (!cur.rows[0]) return `${key}: unknown setting.`;
    const kind = (v: unknown) => (Array.isArray(v) ? 'list' : v === null ? 'null' : typeof v);
    if (kind(cur.rows[0].value) !== kind(value)) return `${key}: must stay a ${kind(cur.rows[0].value)}.`;
    if (typeof value === 'number' && (!Number.isFinite(value) || value < 0)) return `${key}: must be a positive number.`;
    const upd = await tx.query(
      `update public.config set value = $2, confirmed = $3, updated_by = $4 where key = $1`,
      [key, JSON.stringify(value), confirmed, session.id],
    );
    return upd.rowCount === 0 ? 'Only admin can change settings.' : null;
  });
  revalidatePath('/settings');
  back('/settings', error ? { error } : { msg: `${key} saved.` });
}
