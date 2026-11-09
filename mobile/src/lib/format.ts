export const money = (minor: number, currency: string) => `${(minor / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;

/** Converts typed text to minor units, or null if it is not a valid positive amount. */
export function toMinor(text: string): number | null {
  const clean = text.replace(/,/g, '').trim();
  if (!/^\d+(\.\d{0,2})?$/.test(clean)) return null;
  const value = Math.round(Number(clean) * 100);
  return value > 0 ? value : null;
}

export const shortDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
export const dateTime = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
export const titleCase = (s: string) => s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

export function methodLabel(method: string | null, provider?: string | null) {
  if (method === 'mymoney') return 'MyMoney';
  if (provider) return provider;
  return method ? titleCase(method) : '';
}

export function txTitle(t: { type: string; counterpartyName: string | null }) {
  if (t.type === 'pot_deposit') return `To ${t.counterpartyName}`;
  if (t.type === 'pot_withdrawal') return `From ${t.counterpartyName}`;
  if (t.type === 'topup') return 'Money added';
  if (t.type === 'adjustment') return 'Balance adjustment';
  return t.counterpartyName ?? 'Transaction';
}
