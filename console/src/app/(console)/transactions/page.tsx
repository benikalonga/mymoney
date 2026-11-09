'use client';
import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Download } from 'lucide-react';
import { downloadCsv, money, useResource, when } from '@/lib/api';
import { Badge, Empty, Header, Loading, Notice, Pager } from '@/lib/ui';

const STATUSES = ['review', 'pending', 'completed', 'failed', 'reversed'];
const TYPES = ['transfer', 'topup', 'exchange', 'pot_deposit', 'pot_withdrawal', 'bonus', 'adjustment'];

export default function Page() { return <Suspense fallback={<Loading />}><Transactions /></Suspense>; }

function Transactions() {
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState(params.get('status') ?? '');
  const [type, setType] = useState('');
  const [page, setPage] = useState(1);
  const qs = new URLSearchParams({ ...(q && { q }), ...(status && { status }), ...(type && { type }) });
  const { data, error } = useResource(`/admin/transactions?${qs}&page=${page}`, 15_000);
  const change = (fn: () => void) => { fn(); setPage(1); };
  return (
    <>
      <Header title="Transactions">
        <button className="btn" onClick={() => void downloadCsv(`/admin/transactions?${qs}&format=csv`, 'transactions.csv')}><Download size={15} /> Export CSV</button>
      </Header>
      <Notice error={error} />
      <div className="filters">
        <input aria-label="Search transactions" placeholder="Search reference, customer, phone or recipient" value={q} onChange={(e) => change(() => setQ(e.target.value))} />
        <select aria-label="Status" value={status} onChange={(e) => change(() => setStatus(e.target.value))}><option value="">All statuses</option>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
        <select aria-label="Type" value={type} onChange={(e) => change(() => setType(e.target.value))}><option value="">All types</option>{TYPES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}</select>
      </div>
      <div className="card flush">
        {!data ? <Loading /> : data.items.length === 0 ? <Empty text="No transactions match these filters." /> : (
          <>
            <table>
              <thead><tr><th>Reference</th><th>Date</th><th>Customer</th><th>To / from</th><th>Type</th><th>Status</th><th className="num">Amount</th></tr></thead>
              <tbody>
                {data.items.map((t: any) => (
                  <tr key={t.id} className="click" tabIndex={0} onClick={() => router.push(`/transactions/${t.id}`)} onKeyDown={(e) => e.key === 'Enter' && router.push(`/transactions/${t.id}`)}>
                    <td className="mono">{t.reference}</td><td className="muted">{when(t.createdAt)}</td><td>{t.customerName}</td><td>{t.counterpartyName}</td>
                    <td>{t.type.replace('_', ' ')}</td><td><Badge value={t.status} /></td><td className="num">{money(t.sendAmount, t.sendCurrency)}</td>
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
