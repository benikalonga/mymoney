'use client';
import { useEffect, useState } from 'react';
import { api, useResource, when } from '@/lib/api';
import { Header, Loading, Notice } from '@/lib/ui';

function SaveCell({ initial, disabled, onSave, label, step = 'any' }: { initial: number; disabled: boolean; onSave: (n: number) => Promise<unknown>; label: string; step?: string }) {
  const [value, setValue] = useState(String(initial));
  useEffect(() => setValue(String(initial)), [initial]);
  const dirty = Number(value) !== initial && value !== '';
  return (
    <div className="row" style={{ flexWrap: 'nowrap' }}>
      <input aria-label={label} style={{ width: 120 }} type="number" min="0" step={step} disabled={disabled} value={value} onChange={(e) => setValue(e.target.value)} />
      {dirty && <button className="btn primary" onClick={() => onSave(Number(value))}>Save</button>}
    </div>
  );
}

const METHODS: Record<string, string> = { mymoney: 'MyMoney to MyMoney', mobile_money: 'Mobile money payout', bank: 'Bank payout', exchange: 'Currency exchange' };

export default function PricingPage() {
  const { data, error, reload } = useResource('/admin/pricing');
  const { data: me } = useResource('/admin/me');
  const [saveError, setSaveError] = useState<string | null>(null);
  if (!data) return <><Header title="Rates & fees" /><Notice error={error} />{!error && <Loading />}</>;
  const locked = me?.role !== 'owner';
  const save = (path: string, body: object) => api(path, 'PATCH', body).then(() => { setSaveError(null); return reload(); }, (e: Error) => setSaveError(e.message));
  return (
    <>
      <Header title="Rates & fees" sub={locked ? 'Only owners can change these values.' : 'Changes apply to new quotes. Existing quotes keep their price.'} />
      <Notice error={error ?? saveError} />
      <section className="grid g2">
        <div className="card flush">
          <div style={{ padding: '18px 18px 0' }}>
            <h2>Exchange rates (units per 1 USD)</h2>
            <label style={{ marginBottom: 10 }}>Margin on exchange, in basis points (100 = 1%)<SaveCell label="Spread in basis points" step="1" initial={data.spreadBps} disabled={locked} onSave={(n) => save('/admin/pricing/spread', { spreadBps: n })} /></label>
          </div>
          <table>
            <thead><tr><th>Currency</th><th>Per USD</th><th>Updated</th></tr></thead>
            <tbody>
              {data.rates.map((r: any) => (
                <tr key={r.currency}>
                  <td><b>{r.currency}</b><br /><span className="muted">{r.name}</span></td>
                  <td>{r.currency === 'USD' ? '1 (base)' : <SaveCell label={`${r.currency} per USD`} initial={r.perUsd} disabled={locked} onSave={(n) => save(`/admin/pricing/rates/${r.currency}`, { perUsd: n })} />}</td>
                  <td className="muted">{when(r.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="grid" style={{ alignContent: 'start' }}>
          <div className="card flush">
            <div style={{ padding: '18px 18px 0' }}><h2>Fees</h2></div>
            <table>
              <thead><tr><th>Method</th><th>Percent (bps)</th><th>Flat (US cents)</th></tr></thead>
              <tbody>
                {data.fees.map((f: any) => (
                  <tr key={f.method}>
                    <td>{METHODS[f.method] ?? f.method}</td>
                    <td><SaveCell label={`${f.method} percent`} step="1" initial={f.percentBps} disabled={locked} onSave={(n) => save(`/admin/pricing/fees/${f.method}`, { percentBps: n, flatUsd: f.flatUsd })} /></td>
                    <td><SaveCell label={`${f.method} flat`} step="1" initial={f.flatUsd} disabled={locked} onSave={(n) => save(`/admin/pricing/fees/${f.method}`, { percentBps: f.percentBps, flatUsd: n })} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="card flush">
            <div style={{ padding: '18px 18px 0' }}><h2>Tier limits (US cents)</h2></div>
            <table>
              <thead><tr><th>Tier</th><th>Per transfer</th><th>Daily</th><th>Monthly</th></tr></thead>
              <tbody>
                {data.limits.map((l: any) => (
                  <tr key={l.tier}>
                    <td>{l.tier}</td>
                    {(['singleUsd', 'dailyUsd', 'monthlyUsd'] as const).map((k) => (
                      <td key={k}><SaveCell label={`Tier ${l.tier} ${k}`} step="1" initial={l[k]} disabled={locked} onSave={(n) => save(`/admin/pricing/limits/${l.tier}`, { singleUsd: l.singleUsd, dailyUsd: l.dailyUsd, monthlyUsd: l.monthlyUsd, [k]: n })} /></td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </>
  );
}
