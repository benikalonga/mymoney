'use client';
import { useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export const Badge = ({ value }: { value: string }) => <span className={`badge b-${value}`}>{value.replace(/_/g, ' ')}</span>;

export const Header = ({ title, sub, children }: { title: string; sub?: string; children?: ReactNode }) => (
  <header className="page-head">
    <div><h1>{title}</h1>{sub && <p className="muted">{sub}</p>}</div>
    {children && <div className="row">{children}</div>}
  </header>
);

export const Notice = ({ error }: { error: string | null }) => (error ? <div className="alert" role="alert">{error}</div> : null);
export const Loading = () => <p className="muted pad">Loading…</p>;
export const Empty = ({ text }: { text: string }) => <p className="muted pad center">{text}</p>;

export function Pager({ page, total, limit, onPage }: { page: number; total: number; limit: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / limit));
  return (
    <div className="pager">
      <span className="muted">{total.toLocaleString()} result{total === 1 ? '' : 's'}</span>
      <div className="row">
        <button className="btn icon" aria-label="Previous page" disabled={page <= 1} onClick={() => onPage(page - 1)}><ChevronLeft size={16} /></button>
        <span>Page {page} of {pages}</span>
        <button className="btn icon" aria-label="Next page" disabled={page >= pages} onClick={() => onPage(page + 1)}><ChevronRight size={16} /></button>
      </div>
    </div>
  );
}

/** A button that asks for a typed reason before running a sensitive action. */
export function ReasonAction({ label, prompt, danger, onConfirm }: { label: string; prompt: string; danger?: boolean; onConfirm: (reason: string) => Promise<unknown> }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm(reason);
      setOpen(false);
      setReason('');
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  };
  return (
    <>
      <button className={`btn ${danger ? 'danger' : ''}`} onClick={() => setOpen(true)}>{label}</button>
      {open && (
        <div className="modal-back" role="dialog" aria-modal="true" aria-label={label}>
          <div className="modal">
            <h3>{label}</h3>
            <label>{prompt}<textarea rows={3} value={reason} autoFocus onChange={(e) => setReason(e.target.value)} /></label>
            <Notice error={error} />
            <div className="row end">
              <button className="btn" onClick={() => setOpen(false)}>Cancel</button>
              <button className={`btn ${danger ? 'danger' : 'primary'}`} disabled={busy || reason.trim().length < 3} onClick={submit}>{busy ? 'Working…' : 'Confirm'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
