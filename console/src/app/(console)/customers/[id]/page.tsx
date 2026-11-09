'use client';
import { use, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { api, money, usd, useResource, when } from '@/lib/api';
import { Badge, Empty, Header, Loading, Notice, ReasonAction } from '@/lib/ui';

export default function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: u, error, reload } = useResource(`/admin/users/${id}`);
  const { data: me } = useResource('/admin/me');
  const { data: txs } = useResource(`/admin/transactions?userId=${id}&limit=10`);
  const [message, setMessage] = useState<string | null>(null);
  const [adjust, setAdjust] = useState({ currency: 'USD', amount: '', reason: '' });
  const [tier, setTier] = useState('');
  if (!u) return <><Notice error={error} />{!error && <Loading />}</>;
  const owner = me?.role === 'owner';
  const run = (p: Promise<unknown>) => p.then(() => { setMessage(null); return reload(); }, (e: Error) => setMessage(e.message));
  const submitAdjust = (e: FormEvent) => {
    e.preventDefault();
    run(api(`/admin/users/${id}/adjust`, 'POST', { currency: adjust.currency, amount: Math.round(Number(adjust.amount) * 100), reason: adjust.reason }).then(() => setAdjust({ currency: adjust.currency, amount: '', reason: '' })));
  };
  const setStatus = (status: string, reason: string) => api(`/admin/users/${id}`, 'PATCH', { status, reason }).then(reload);
  return (
    <>
      <Header title={`${u.firstName} ${u.lastName}`} sub={`@${u.tag} · ${u.phone} · joined ${when(u.createdAt)}`}>
        <Badge value={u.status} />
        {u.locked && <button className="btn" onClick={() => run(api(`/admin/users/${id}/unlock`, 'POST', {}))}>Unlock PIN</button>}
        {u.status === 'active'
          ? <ReasonAction danger label="Freeze account" prompt="Why is this account being frozen?" onConfirm={(r) => setStatus('frozen', r)} />
          : <ReasonAction label="Restore account" prompt="Why is this account being restored?" onConfirm={(r) => setStatus('active', r)} />}
      </Header>
      <Notice error={message} />
      <section className="grid g2">
        <div className="card">
          <h2>Balances</h2>
          {u.wallets.length === 0 && <p className="muted">No accounts.</p>}
          {u.wallets.map((w: any, i: number) => <div key={i} className="row between"><span style={{ textTransform: 'capitalize' }}>{w.kind === 'pot' ? 'Savings goal' : 'Wallet'} · {w.currency}</span><span className="num">{money(w.balance, w.currency)}</span></div>)}
        </div>
        <div className="card">
          <h2>Limits (tier {u.tier})</h2>
          <dl className="kv">
            <dt>Per transfer</dt><dd>{usd(u.limits.singleUsd)}</dd>
            <dt>Last 24 hours</dt><dd>{usd(u.limits.usedDailyUsd)} of {usd(u.limits.dailyUsd)}</dd>
            <dt>This month</dt><dd>{usd(u.limits.usedMonthlyUsd)} of {usd(u.limits.monthlyUsd)}</dd>
          </dl>
          {owner && (
            <div className="row mt">
              <select aria-label="New tier" style={{ width: 120 }} value={tier} onChange={(e) => setTier(e.target.value)}><option value="">Change tier</option><option value="1">Tier 1</option><option value="2">Tier 2</option><option value="3">Tier 3</option></select>
              {tier && <ReasonAction label="Apply" prompt={`Why move this customer to tier ${tier}?`} onConfirm={(reason) => api(`/admin/users/${id}`, 'PATCH', { tier: Number(tier), reason }).then(() => { setTier(''); return reload(); })} />}
            </div>
          )}
        </div>
      </section>
      {owner && (
        <form className="card mt" onSubmit={submitAdjust}>
          <h2>Adjust balance</h2>
          <div className="row">
            <input aria-label="Currency" style={{ width: 90 }} maxLength={3} value={adjust.currency} onChange={(e) => setAdjust({ ...adjust, currency: e.target.value.toUpperCase() })} />
            <input aria-label="Amount" style={{ width: 150 }} type="number" step="0.01" placeholder="+/- amount" required value={adjust.amount} onChange={(e) => setAdjust({ ...adjust, amount: e.target.value })} />
            <input aria-label="Reason" style={{ flex: 1, minWidth: 200, width: 'auto' }} placeholder="Reason (recorded and shown to the customer)" required minLength={3} value={adjust.reason} onChange={(e) => setAdjust({ ...adjust, reason: e.target.value })} />
            <button className="btn primary">Post adjustment</button>
          </div>
        </form>
      )}
      <div className="card flush mt">
        <div style={{ padding: '18px 18px 0' }}><h2>Latest transactions</h2></div>
        {!txs ? <Loading /> : txs.items.length === 0 ? <Empty text="No transactions yet." /> : (
          <table>
            <tbody>
              {txs.items.map((t: any) => (
                <tr key={t.id}><td className="mono"><Link className="link" href={`/transactions/${t.id}`}>{t.reference}</Link></td><td className="muted">{when(t.createdAt)}</td><td>{t.counterpartyName}</td><td><Badge value={t.status} /></td><td className="num">{money(t.sendAmount, t.sendCurrency)}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
