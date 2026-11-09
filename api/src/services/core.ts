import { db } from '../db';
import { price, toUsd, type FeeRule } from '../domain/pricing';
import { ApiError, invalid, notFound } from '../lib/http';
import { newId, now } from '../lib/ids';

export interface UserRow {
  id: string; phone: string; first_name: string; last_name: string; email: string | null; tag: string; pin_hash: string;
  status: 'active' | 'frozen' | 'closed'; tier: number; kyc_status: string; default_currency: string; failed_pins: number;
  locked_until: string | null; referral_code: string; referred_by: string | null; referral_rewarded_at: string | null; created_at: string;
}

export interface TxRow {
  id: string; reference: string; type: string; status: string; user_id: string; method: string | null; provider: string | null;
  payout_account: string | null; recipient_id: string | null; counterparty_id: string | null; counterparty_name: string | null;
  send_currency: string; send_amount: number; fee: number; rate: number; receive_currency: string; receive_amount: number; usd_value: number;
  note: string | null; category: string | null; review_reason: string | null; failure_reason: string | null; idempotency_key: string | null;
  provider_ref: string | null; provider_due_at: string | null; schedule_id: string | null; request_id: string | null; pot_id: string | null;
  created_at: string; completed_at: string | null;
}

export const getUser = (id: string) => db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
export const getTx = (id: string) => db.prepare('SELECT * FROM transactions WHERE id = ?').get(id) as TxRow | undefined;
export const fullName = (u: Pick<UserRow, 'first_name' | 'last_name'>) => `${u.first_name} ${u.last_name}`;

export function requireActive(userId: string): UserRow {
  const user = getUser(userId);
  if (!user) throw notFound('Account');
  if (user.status !== 'active') throw new ApiError(403, 'ACCOUNT_FROZEN', 'This account is frozen. Please contact support.');
  return user;
}

export function perUsd(currency: string): number {
  const row = db.prepare('SELECT per_usd FROM rates WHERE currency = ?').get(currency) as { per_usd: number } | undefined;
  if (!row) throw invalid(`${currency} is not supported`, 'UNSUPPORTED_CURRENCY');
  return row.per_usd;
}

export const usdValue = (amount: number, currency: string) => toUsd(amount, perUsd(currency));
export const spreadBps = () => Number((db.prepare("SELECT value FROM settings WHERE key = 'spread_bps'").get() as { value: string }).value);

export function feeRule(method: string): FeeRule {
  const row = db.prepare('SELECT percent_bps, flat_usd FROM fee_rules WHERE method = ?').get(method) as { percent_bps: number; flat_usd: number };
  return { percentBps: row.percent_bps, flatUsd: row.flat_usd };
}

export function priceFor(method: string, sendCurrency: string, receiveCurrency: string, amounts: { sendAmount?: number; receiveAmount?: number }) {
  return price({
    ...amounts,
    sendPerUsd: perUsd(sendCurrency),
    receivePerUsd: perUsd(receiveCurrency),
    spreadBps: spreadBps(),
    fee: feeRule(method),
    sameCurrency: sendCurrency === receiveCurrency,
  });
}

export function formatMoney(amount: number, currency: string) {
  return `${(amount / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

export function notify(userId: string, kind: string, title: string, body: string, transactionId?: string) {
  db.prepare('INSERT INTO notifications (id, user_id, kind, title, body, transaction_id, created_at) VALUES (?,?,?,?,?,?,?)')
    .run(newId(), userId, kind, title, body, transactionId ?? null, now());
}

export function limitUsage(user: Pick<UserRow, 'id' | 'tier'>) {
  const limits = db.prepare('SELECT single_usd, daily_usd, monthly_usd FROM tier_limits WHERE tier = ?').get(user.tier) as { single_usd: number; daily_usd: number; monthly_usd: number };
  const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
  const monthStart = `${new Date().toISOString().slice(0, 7)}-01T00:00:00.000Z`;
  const sum = db.prepare(`SELECT COALESCE(SUM(usd_value), 0) AS total FROM transactions
    WHERE user_id = ? AND type = 'transfer' AND status NOT IN ('failed','reversed') AND created_at >= ?`);
  return {
    singleUsd: limits.single_usd,
    dailyUsd: limits.daily_usd,
    monthlyUsd: limits.monthly_usd,
    usedDailyUsd: (sum.get(user.id, dayAgo) as { total: number }).total,
    usedMonthlyUsd: (sum.get(user.id, monthStart) as { total: number }).total,
  };
}

export function assertWithinLimits(user: UserRow, usd: number) {
  const usage = limitUsage(user);
  const fail = (scope: string) => new ApiError(422, 'LIMIT_EXCEEDED', `This would go over your ${scope} limit. Verify your identity to raise it.`);
  if (usd > usage.singleUsd) throw fail('per-transfer');
  if (usage.usedDailyUsd + usd > usage.dailyUsd) throw fail('daily');
  if (usage.usedMonthlyUsd + usd > usage.monthlyUsd) throw fail('monthly');
}
