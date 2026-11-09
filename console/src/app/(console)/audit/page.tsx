'use client';
import { useState } from 'react';
import { useResource, when } from '@/lib/api';
import { Empty, Header, Loading, Notice, Pager } from '@/lib/ui';

export default function AuditPage() {
  const [page, setPage] = useState(1);
  const { data, error } = useResource(`/admin/audit?page=${page}`);
  return (
    <>
      <Header title="Audit log" sub="Every sensitive staff action, in order. Entries cannot be edited." />
      <Notice error={error} />
      <div className="card flush">
        {!data ? <Loading /> : data.items.length === 0 ? <Empty text="No staff actions yet." /> : (
          <>
            <table>
              <thead><tr><th>When</th><th>Staff</th><th>Action</th><th>Target</th><th>Detail</th></tr></thead>
              <tbody>
                {data.items.map((a: any) => <tr key={a.id}><td className="muted">{when(a.createdAt)}</td><td>{a.staffName}</td><td className="mono">{a.action}</td><td className="mono">{a.targetId}</td><td>{a.detail ?? '—'}</td></tr>)}
              </tbody>
            </table>
            <Pager page={data.page} total={data.total} limit={data.limit} onPage={setPage} />
          </>
        )}
      </div>
    </>
  );
}
