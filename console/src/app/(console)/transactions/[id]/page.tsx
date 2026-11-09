'use client';
import { use, useState } from 'react';
import Link from 'next/link';
import { api, money, usd, useResource, when } from '@/lib/api';
import { Badge, Header, Loading, Notice, ReasonAction } from '@/lib/ui';

export default function TransactionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: t, error, reload } = useResource(`/admin/transactions/${id}`);
  const { data: me } = useResource('/admin/me');
  const [actionError, setActionError] = useState<string | null>(null);
  if (!t) return <><Notice error={error} />{!error && <Loading />}</>;
  const act = async (verb: string, body: object = {}) => {
    await api(`/admin/transactions/${id}/${verb}`, 'POST', body);
    await reload();
  };
  const approve = () => { setActionError(null); act('approve').catch((e: Error) => setActionError(e.message)); };
  return (
    <>
      <Header title={t.reference} sub={`${t.type.replace('_', ' ')}, created ${when(t.createdAt)}`}>
        <Badge value={t.status} />
        {t.status === 'review' && <>
          <button className="btn primary" onClick={approve}>Approve</button>
          <ReasonAction danger label="Reject and refund" prompt="Why is this transfer being rejected? The customer will see this." onConfirm={(reason) => act('reject', { reason })} />
        </>}
        {t.status === 'completed' && t.type === 'transfer' && me?.role === 'owner' && (
          <ReasonAction danger label="Reverse" prompt="Why is this transfer being reversed? Both customers will see this." onConfirm={(reason) => act('reverse', { reason })} />
        )}
      </Header>
      <Notice error={actionError} />
      <section className="grid g2">
        <div className="card">
          <h2>Details</h2>
          <dl className="kv">
            <dt>Customer</dt><dd><Link className="link" href={`/customers/${t.userId}`}>{t.customerName}</Link> ({t.customerPhone})</dd>
            <dt>To / from</dt><dd>{t.counterpartyId ? <Link className="link" href={`/customers/${t.counterpartyId}`}>{t.counterpartyName}</Link> : t.counterpartyName}</dd>
            <dt>Method</dt><dd>{[t.method?.replace('_', ' '), t.provider].filter(Boolean).join(', ') || '—'}</dd>
            {t.payoutAccount && <><dt>Account</dt><dd className="mono">{t.payoutAccount}</dd></>}
            <dt>Sent</dt><dd>{money(t.sendAmount, t.sendCurrency)}</dd>
            <dt>Fee</dt><dd>{money(t.fee, t.sendCurrency)}</dd>
            <dt>Rate</dt><dd>{t.rate.toFixed(4)}</dd>
            <dt>Received</dt><dd>{money(t.receiveAmount, t.receiveCurrency)}</dd>
            <dt>USD value</dt><dd>{usd(t.usdValue)}</dd>
            {t.note && <><dt>Note</dt><dd>{t.note}</dd></>}
            {t.reviewReason && <><dt>Review reason</dt><dd>{t.reviewReason}</dd></>}
            {t.failureReason && <><dt>Outcome note</dt><dd>{t.failureReason}</dd></>}
            {t.providerRef && <><dt>Provider ref</dt><dd className="mono">{t.providerRef}</dd></>}
            <dt>Completed</dt><dd>{when(t.completedAt)}</dd>
          </dl>
        </div>
        <div className="card flush">
          <div style={{ padding: '18px 18px 0' }}><h2>Ledger entries</h2></div>
          <table>
            <thead><tr><th>Account</th><th>Currency</th><th className="num">Amount</th></tr></thead>
            <tbody>
              {t.entries.map((e: any) => (
                <tr key={e.id}><td style={{ textTransform: 'capitalize' }}>{e.kind}</td><td>{e.currency}</td><td className={`num ${e.amount < 0 ? 'neg' : 'pos'}`}>{e.amount > 0 ? '+' : ''}{(e.amount / 100).toFixed(2)}</td></tr>
              ))}
            </tbody>
          </table>
          {t.entries.length === 0 && <p className="muted pad center">No money has moved yet.</p>}
        </div>
      </section>
    </>
  );
}
