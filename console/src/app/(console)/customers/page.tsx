'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useResource, when } from '@/lib/api';
import { Badge, Empty, Header, Loading, Notice, Pager } from '@/lib/ui';

export default function CustomersPage() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const qs = new URLSearchParams({ ...(q && { q }), ...(status && { status }), page: String(page) });
  const { data, error } = useResource(`/admin/users?${qs}`);
  return (
    <>
      <Header title="Customers" />
      <Notice error={error} />
      <div className="filters">
        <input aria-label="Search customers" placeholder="Search name, phone or tag" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        <select aria-label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="">All statuses</option><option>active</option><option>frozen</option></select>
      </div>
      <div className="card flush">
        {!data ? <Loading /> : data.items.length === 0 ? <Empty text="No customers found." /> : (
          <>
            <table>
              <thead><tr><th>Name</th><th>Phone</th><th>Tag</th><th>Tier</th><th>Verification</th><th>Status</th><th>Joined</th></tr></thead>
              <tbody>
                {data.items.map((u: any) => (
                  <tr key={u.id} className="click" tabIndex={0} onClick={() => router.push(`/customers/${u.id}`)} onKeyDown={(e) => e.key === 'Enter' && router.push(`/customers/${u.id}`)}>
                    <td>{u.firstName} {u.lastName}</td><td className="mono">{u.phone}</td><td>@{u.tag}</td><td>{u.tier}</td><td><Badge value={u.kycStatus} /></td><td><Badge value={u.status} /></td><td className="muted">{when(u.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pager page={data.page} total={data.total} limit={data.limit} onPage={setPage} />
          </>
        )}
      </div>
    </>
  );
}
