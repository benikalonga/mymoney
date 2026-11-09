import { config } from '../config';
import { db } from '../db';
import { nextRunDate, type Frequency } from '../domain/schedule';
import { customerRate } from '../domain/pricing';
import { ApiError } from '../lib/http';
import { now } from '../lib/ids';
import { formatMoney, notify, perUsd, priceFor, spreadBps, type TxRow } from './core';
import { executeTransfer, settleProvider } from './transfers';

interface ScheduleRow {
  id: string; user_id: string; recipient_id: string; send_currency: string; amount: number; frequency: Frequency; anchor_day: number; note: string | null; next_run_at: string; failures: number;
}
interface RecipientRow {
  id: string; name: string; method: 'mymoney' | 'mobile_money' | 'bank'; provider: string | null; account: string; currency: string; counterparty_id: string | null; deleted_at: string | null;
}

export function settleDueProviders() {
  if (config.providerMode !== 'sandbox') return;
  const due = db.prepare("SELECT * FROM transactions WHERE status = 'pending' AND provider_due_at IS NOT NULL AND provider_due_at <= ?").all(now()) as TxRow[];
  for (const t of due) {
    const declined = t.type === 'transfer' && (t.payout_account ?? '').endsWith('0000');
    settleProvider(t, !declined, declined ? 'The receiving account was rejected by the payout partner.' : undefined);
  }
}

export function runDueSchedules() {
  const due = db.prepare("SELECT * FROM schedules WHERE status = 'active' AND COALESCE(retry_at, next_run_at) <= ?").all(now()) as ScheduleRow[];
  for (const s of due) {
    const recipient = db.prepare('SELECT * FROM recipients WHERE id = ?').get(s.recipient_id) as RecipientRow;
    try {
      if (recipient.deleted_at) throw new ApiError(422, 'RECIPIENT_REMOVED', 'The recipient was removed');
      const p = priceFor(recipient.method, s.send_currency, recipient.currency, { sendAmount: s.amount });
      const { transaction } = executeTransfer({
        userId: s.user_id, method: recipient.method, sendCurrency: s.send_currency, sendAmount: p.sendAmount, fee: p.fee, rate: p.rate,
        receiveCurrency: recipient.currency, receiveAmount: p.receiveAmount, counterpartyId: recipient.counterparty_id, counterpartyName: recipient.name,
        recipientId: recipient.id, provider: recipient.provider, payoutAccount: recipient.method === 'mymoney' ? null : recipient.account, note: s.note,
        category: 'scheduled', idempotencyKey: `schedule:${s.id}:${s.next_run_at}`, scheduleId: s.id,
      });
      // After downtime, skip missed dates rather than paying them all at once.
      let next = nextRunDate(new Date(s.next_run_at), s.frequency, s.anchor_day);
      while (next.getTime() <= Date.now()) next = nextRunDate(next, s.frequency, s.anchor_day);
      db.prepare('UPDATE schedules SET next_run_at = ?, retry_at = NULL, failures = 0, last_result = ? WHERE id = ?').run(next.toISOString(), `Sent ${transaction.reference}`, s.id);
    } catch (err) {
      if (!(err instanceof ApiError)) console.error('Scheduled payment failed', s.id, err);
      const message = err instanceof ApiError ? err.message : 'Temporary problem';
      const failures = s.failures + 1;
      const paused = failures >= config.scheduleMaxFailures;
      const retry = new Date(Date.now() + 86_400_000).toISOString();
      db.prepare('UPDATE schedules SET failures = ?, retry_at = ?, last_result = ?, status = ? WHERE id = ?').run(failures, retry, message, paused ? 'paused' : 'active', s.id);
      notify(s.user_id, 'schedule_failed', paused ? 'Scheduled payment paused' : 'Scheduled payment failed',
        `${formatMoney(s.amount, s.send_currency)} to ${recipient.name}: ${message}${paused ? '' : ' We will try again tomorrow.'}`);
    }
  }
}

export function checkRateAlerts() {
  const alerts = db.prepare('SELECT * FROM rate_alerts WHERE active = 1').all() as { id: string; user_id: string; from_currency: string; to_currency: string; target: number; direction: string }[];
  for (const a of alerts) {
    const rate = customerRate(perUsd(a.from_currency), perUsd(a.to_currency), spreadBps(), a.from_currency === a.to_currency);
    const hit = a.direction === 'above' ? rate >= a.target : rate <= a.target;
    if (!hit) continue;
    db.prepare('UPDATE rate_alerts SET active = 0, triggered_at = ? WHERE id = ?').run(now(), a.id);
    notify(a.user_id, 'rate_alert', 'Rate alert', `1 ${a.from_currency} is now ${rate.toFixed(4)} ${a.to_currency}.`);
  }
}

export function expireOldRecords() {
  const stamp = now();
  const expired = db.prepare("SELECT id, requester_id FROM money_requests WHERE status = 'pending' AND expires_at <= ?").all(stamp) as { id: string; requester_id: string }[];
  for (const r of expired) {
    db.prepare("UPDATE money_requests SET status = 'expired' WHERE id = ?").run(r.id);
    notify(r.requester_id, 'request_expired', 'Request expired', 'A payment request you sent was not paid in time.');
  }
  db.prepare('DELETE FROM quotes WHERE expires_at <= ?').run(new Date(Date.now() - 86_400_000).toISOString());
}

export function tick() {
  for (const job of [settleDueProviders, runDueSchedules, checkRateAlerts, expireOldRecords]) {
    try {
      job();
    } catch (err) {
      console.error(`Job ${job.name} failed`, err);
    }
  }
}
