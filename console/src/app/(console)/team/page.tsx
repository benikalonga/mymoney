'use client';
import { useState, type FormEvent } from 'react';
import { api, useResource, when } from '@/lib/api';
import { Badge, Header, Loading, Notice } from '@/lib/ui';

const BLANK = { name: '', email: '', password: '', role: 'agent' };

export default function TeamPage() {
  const { data, error, reload } = useResource<any[]>('/admin/team');
  const { data: me } = useResource('/admin/me');
  const [form, setForm] = useState(BLANK);
  const [formError, setFormError] = useState<string | null>(null);
  const add = (e: FormEvent) => {
    e.preventDefault();
    api('/admin/team', 'POST', form).then(() => { setForm(BLANK); setFormError(null); return reload(); }, (err: Error) => setFormError(err.message));
  };
  const toggle = (id: string, active: boolean) => api(`/admin/team/${id}`, 'PATCH', { active }).then(reload, (err: Error) => setFormError(err.message));
  return (
    <>
      <Header title="Team" />
      <Notice error={error ?? formError} />
      <div className="card flush">
        {!data ? <Loading /> : (
          <table>
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Added</th><th /></tr></thead>
            <tbody>
              {data.map((s) => (
                <tr key={s.id}>
                  <td>{s.name}</td><td>{s.email}</td><td style={{ textTransform: 'capitalize' }}>{s.role}</td><td><Badge value={s.active ? 'active' : 'frozen'} /></td><td className="muted">{when(s.createdAt)}</td>
                  <td className="num">{s.id !== me?.id && <button className="btn" onClick={() => void toggle(s.id, !s.active)}>{s.active ? 'Deactivate' : 'Reactivate'}</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <form className="card mt" onSubmit={add}>
        <h2>Add a staff member</h2>
        <div className="grid g4">
          <label>Name<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label>Email<input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
          <label>Temporary password<input required type="password" minLength={12} autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></label>
          <label>Role<select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}><option value="agent">Agent</option><option value="owner">Owner</option></select></label>
        </div>
        <div className="row end mt"><button className="btn primary">Add staff member</button></div>
      </form>
    </>
  );
}
