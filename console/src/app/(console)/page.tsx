'use client';
import Link from 'next/link';
import { money, usd, useResource } from '@/lib/api';
import { Header, Loading, Notice } from '@/lib/ui';

export default function OverviewPage() {
  const { data, error } = useResource('/admin/overview', 15_000);
  if (!data) return <><Header title="Overview" /><Notice error={error} />{!error && <Loading />}</>;
  const max = Math.max(1, ...data.series.map((d: any) => d.usd));
  const total = data.series.reduce((s: number, d: any) => s + d.usd, 0);
  return (
    <>
      <Header title="Overview" sub="Refreshes every 15 seconds." />
      <Notice error={error} />
      <section className="grid g4">
        <div className="card stat"><small>Sent today</small><b>{usd(data.volumeTodayUsd)}</b><br /><span>{data.transfersToday} transfers</span></div>
        <div className="card stat"><small>Customers</small><b>{data.customers.toLocaleString()}</b><br /><span>{data.newToday} new today, {data.frozen} frozen</span></div>
        <div className="card stat"><small>Waiting for review</small><b>{data.reviewQueue}</b><br /><Link className="link" href="/transactions?status=review">Open queue</Link></div>
        <div className="card stat"><small>Fees earned</small><b>{usd(data.feesUsd)}</b><br /><span>{data.inFlight} payouts in flight</span></div>
      </section>
      <section className="grid g21 mt">
        <div className="card">
          <div className="row between"><h2>Completed transfers, last 30 days</h2><span className="muted">{usd(total)}</span></div>
          <div className="chart" role="img" aria-label={`Daily transfer volume, ${usd(total)} over 30 days`}>
            {data.series.map((d: any) => <div key={d.day} style={{ height: `${(d.usd / max) * 100}%` }} title={`${d.day}: ${usd(d.usd)} (${d.count})`} />)}
          </div>
        </div>
        <div className="card">
          <h2>Ledger</h2>
          <p className={data.ledgerHealthy ? 'success' : 'alert'}>{data.ledgerHealthy ? 'Balanced. Every account matches its entries.' : 'Imbalance detected. Investigate before processing more transfers.'}</p>
          <h2 className="mt">Customer funds</h2>
          {data.float.length === 0 && <p className="muted">No balances yet.</p>}
          {data.float.map((f: any) => <div key={f.currency} className="row between"><span>{f.currency}</span><span className="num">{money(f.balance, f.currency)}</span></div>)}
        </div>
      </section>
    </>
  );
}
