'use client';
import { usePathname } from 'next/navigation';
import { viewAs } from '../actions';

const ROLE = { admin: 'Founder', front_desk: 'Front desk', designer: 'Designer' } as const;

export function ViewAs({
  current,
  staff,
}: {
  current: string;
  staff: { id: string; name: string; role: keyof typeof ROLE }[];
}) {
  const path = usePathname();
  return (
    <form action={viewAs} className="view-as">
      <input type="hidden" name="returnTo" value={path} />
      <label htmlFor="view-as">Viewing as</label>
      <select id="view-as" name="staffId" defaultValue={current} onChange={(e) => e.currentTarget.form?.requestSubmit()}>
        {(['admin', 'front_desk', 'designer'] as const).map((role) => (
          <optgroup key={role} label={ROLE[role]}>
            {staff
              .filter((s) => s.role === role)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </optgroup>
        ))}
      </select>
    </form>
  );
}
