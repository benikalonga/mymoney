import { config } from '../config';
import { db, tx } from '../db';
import { ensureWallet, post, reverseEntries, systemAccount, type Leg } from '../domain/ledger';
import { ApiError, invalid, notFound } from '../lib/http';
import { newId, newProviderRef, newReference, now } from '../lib/ids';
import { assertWithinLimits, formatMoney, fullName, getTx, getUser, notify, perUsd, priceFor, requireActive, usdValue, type TxRow } from './core';

export interface TransferInput {
  userId: string;
  method: 'mymoney' | 'mobile_money' | 'bank';
  sendCurrency: string;
  sendAmount: number;
  fee: number;
  rate: number;
  receiveCurrency: string;
  receiveAmount: number;
  counterpartyId?: string | null;
  counterpartyName: string;
  recipientId?: string | null;
  provider?: string | null;
  payoutAccount?: string | null;
  note?: string | null;
  category?: string | null;
  idempotencyKey?: string | null;
  scheduleId?: string | null;
  requestId?: string | null;
}

const insertTx = db.prepare(`INSERT INTO transactions (id, reference, type, status, user_id, method, provider, payout_account, recipient_id,
  counterparty_id, counterparty_name, send_currency, send_amount, fee, rate, receive_currency, receive_amount, usd_value, note, category,
  review_reason, idempotency_key, provider_ref, provider_due_at, schedule_id, request_id, pot_id, created_at, completed_at)
  VALUES (@id,@reference,@type,@status,@user_id,@method,@provider,@payout_account,@recipient_id,@counterparty_id,@counterparty_name,@send_currency,
  @send_amount,@fee,@rate,@receive_currency,@receive_amount,@usd_value,@note,@category,@review_reason,@idempotency_key,@provider_ref,@provider_due_at,
  @schedule_id,@request_id,@pot_id,@created_at,@completed_at)`);

export function createTx(fields: Partial<TxRow> & Pick<TxRow, 'type' | 'status' | 'user_id' | 'send_currency' | 'send_amount' | 'receive_currency' | 'receive_amount'>): TxRow {
  const row = {
    id: newId(), reference: newReference(), method: null, provider: null, payout_account: null, recipient_id: null, counterparty_id: null,
    counterparty_name: null, fee: 0, rate: 1, usd_value: 0, note: null, category: null, review_reason: null, idempotency_key: null, provider_ref: null,
    provider_due_at: null, schedule_id: null, request_id: null, pot_id: null, created_at: now(), completed_at: null, ...fields,
  };
  insertTx.run(row);
  return getTx(row.id)!;
}

export const findByIdempotency = (userId: string, key: string) =>
  db.prepare('SELECT * FROM transactions WHERE user_id = ? AND idempotency_key = ?').get(userId, key) as TxRow | undefined;

const setStatus = (id: string, status: string, extra: { failure_reason?: string | null; completed_at?: string | null; provider_ref?: string | null; provider_due_at?: string | null } = {}) => {
  db.prepare(`UPDATE transactions SET status = ?, failure_reason = COALESCE(?, failure_reason), completed_at = COALESCE(?, completed_at),
    provider_ref = COALESCE(?, provider_ref), provider_due_at = ? WHERE id = ?`)
    .run(status, extra.failure_reason ?? null, extra.completed_at ?? null, extra.provider_ref ?? null, extra.provider_due_at ?? null, id);
};

const providerDueAt = () => (config.providerMode === 'sandbox' ? new Date(Date.now() + config.sandboxSettleSeconds * 1000).toISOString() : null);

function reviewReason(usd: number, userId: string): string | null {
  if (usd >= config.reviewThresholdUsd) return 'Large transfer';
  const tenMinutesAgo = new Date(Date.now() - 600_000).toISOString();
  const recent = db.prepare("SELECT COUNT(*) AS n FROM transactions WHERE user_id = ? AND type = 'transfer' AND created_at >= ?").get(userId, tenMinutesAgo) as { n: number };
  return recent.n >= config.velocityLimit ? 'Unusual number of transfers' : null;
}

/** Bonus for the inviter and the new customer, once, after a first qualifying payment. */
function rewardReferral(userId: string, usd: number) {
  const user = getUser(userId)!;
  if (!user.referred_by || user.referral_rewarded_at || usd < config.referralQualifyingUsd) return;
  db.prepare('UPDATE users SET referral_rewarded_at = ? WHERE id = ?').run(now(), userId);
  for (const id of [user.id, user.referred_by]) {
    const person = getUser(id)!;
    const currency = person.default_currency;
    const amount = Math.ceil(config.referralBonusUsd * perUsd(currency));
    const bonus = createTx({ type: 'bonus', status: 'completed', user_id: id, send_currency: currency, send_amount: amount, receive_currency: currency, receive_amount: amount, completed_at: now(), counterparty_name: 'MyMoney referral bonus' });
    post(bonus.id, [{ account: systemAccount('promo', currency), amount: -amount }, { account: ensureWallet(id, currency), amount }]);
    notify(id, 'bonus', 'Referral bonus', `${formatMoney(amount, currency)} was added to your wallet.`, bonus.id);
  }
}

function complete(t: TxRow) {
  setStatus(t.id, 'completed', { completed_at: now() });
  notify(t.user_id, 'transfer_sent', 'Money sent', `${formatMoney(t.receive_amount, t.receive_currency)} reached ${t.counterparty_name}.`, t.id);
  if (t.counterparty_id) {
    const sender = getUser(t.user_id)!;
    notify(t.counterparty_id, 'transfer_received', 'Money received', `${fullName(sender)} sent you ${formatMoney(t.receive_amount, t.receive_currency)}.`, t.id);
  }
  rewardReferral(t.user_id, t.usd_value);
}

/** Moves held funds from clearing to the destination. */
function settle(t: TxRow) {
  const clearing = systemAccount('clearing', t.send_currency);
  const legs: Leg[] = [
    { account: clearing, amount: -(t.send_amount + t.fee) },
    { account: systemAccount('fees', t.send_currency), amount: t.fee },
  ];
  if (t.method === 'mymoney') {
    const wallet = ensureWallet(t.counterparty_id!, t.receive_currency);
    if (t.send_currency === t.receive_currency) {
      legs.push({ account: wallet, amount: t.send_amount });
    } else {
      legs.push(
        { account: systemAccount('fx', t.send_currency), amount: t.send_amount },
        { account: systemAccount('fx', t.receive_currency), amount: -t.receive_amount },
        { account: wallet, amount: t.receive_amount },
      );
    }
  } else {
    legs.push({ account: systemAccount('external', t.send_currency), amount: t.send_amount });
  }
  post(t.id, legs);
  complete(t);
}

function dispatch(t: TxRow) {
  if (t.method === 'mymoney') settle(t);
  else setStatus(t.id, 'pending', { provider_ref: newProviderRef(), provider_due_at: providerDueAt() });
}

function releaseHold(t: TxRow, reason: string) {
  post(t.id, [
    { account: systemAccount('clearing', t.send_currency), amount: -(t.send_amount + t.fee) },
    { account: ensureWallet(t.user_id, t.send_currency), amount: t.send_amount + t.fee },
  ]);
  setStatus(t.id, 'failed', { failure_reason: reason });
  if (t.request_id) db.prepare("UPDATE money_requests SET status = 'pending', transaction_id = NULL WHERE id = ? AND status = 'paid'").run(t.request_id);
  notify(t.user_id, 'transfer_failed', 'Transfer not completed', `${formatMoney(t.send_amount + t.fee, t.send_currency)} was returned to your wallet. ${reason}`, t.id);
}

export function executeTransfer(input: TransferInput): { transaction: TxRow; replayed: boolean } {
  return tx(() => {
    if (input.idempotencyKey) {
      const existing = findByIdempotency(input.userId, input.idempotencyKey);
      if (existing) return { transaction: existing, replayed: true };
    }
    if (input.sendAmount <= 0 || input.receiveAmount <= 0) throw invalid('The amount is too small to send');
    const sender = requireActive(input.userId);
    if (input.counterpartyId) {
      if (input.counterpartyId === input.userId) throw invalid('You cannot send money to yourself');
      requireActive(input.counterpartyId);
    }
    const usd = usdValue(input.sendAmount, input.sendCurrency);
    assertWithinLimits(sender, usd);
    const reason = reviewReason(usd, sender.id);

    const t = createTx({
      type: 'transfer', status: reason ? 'review' : 'processing', user_id: sender.id, method: input.method, provider: input.provider ?? null,
      payout_account: input.payoutAccount ?? null, recipient_id: input.recipientId ?? null, counterparty_id: input.counterpartyId ?? null,
      counterparty_name: input.counterpartyName, send_currency: input.sendCurrency, send_amount: input.sendAmount, fee: input.fee, rate: input.rate,
      receive_currency: input.receiveCurrency, receive_amount: input.receiveAmount, usd_value: usd, note: input.note ?? null, category: input.category ?? null,
      review_reason: reason, idempotency_key: input.idempotencyKey ?? null, schedule_id: input.scheduleId ?? null, request_id: input.requestId ?? null,
    });
    post(t.id, [
      { account: ensureWallet(sender.id, input.sendCurrency), amount: -(input.sendAmount + input.fee) },
      { account: systemAccount('clearing', input.sendCurrency), amount: input.sendAmount + input.fee },
    ]);
    if (input.recipientId) db.prepare('UPDATE recipients SET last_used_at = ? WHERE id = ?').run(now(), input.recipientId);

    if (reason) notify(sender.id, 'transfer_review', 'Transfer under review', 'We are doing a quick safety check on this transfer. Your money is held safely.', t.id);
    else dispatch(t);
    return { transaction: getTx(t.id)!, replayed: false };
  });
}

export function approveReview(id: string) {
  return tx(() => {
    const t = getTx(id);
    if (!t) throw notFound('Transaction');
    if (t.status !== 'review') throw new ApiError(409, 'INVALID_STATE', 'Only transfers under review can be approved');
    setStatus(t.id, 'processing');
    dispatch(getTx(t.id)!);
    return getTx(t.id)!;
  });
}

export function rejectReview(id: string, reason: string) {
  return tx(() => {
    const t = getTx(id);
    if (!t) throw notFound('Transaction');
    if (t.status !== 'review') throw new ApiError(409, 'INVALID_STATE', 'Only transfers under review can be rejected');
    releaseHold(t, reason);
    return getTx(t.id)!;
  });
}

export function reverseTransaction(id: string, reason: string) {
  return tx(() => {
    const t = getTx(id);
    if (!t) throw notFound('Transaction');
    if (t.status !== 'completed' || t.type !== 'transfer') throw new ApiError(409, 'INVALID_STATE', 'Only completed transfers can be reversed');
    try {
      reverseEntries(t.id);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'INSUFFICIENT_FUNDS') {
        throw new ApiError(409, 'FUNDS_SPENT', 'The recipient no longer has enough balance to reverse this transfer');
      }
      throw err;
    }
    setStatus(t.id, 'reversed', { failure_reason: reason });
    notify(t.user_id, 'transfer_reversed', 'Transfer reversed', `${formatMoney(t.send_amount + t.fee, t.send_currency)} was returned to your wallet. ${reason}`, t.id);
    if (t.counterparty_id) notify(t.counterparty_id, 'transfer_reversed', 'Payment reversed', `${formatMoney(t.receive_amount, t.receive_currency)} was taken back from your wallet. ${reason}`, t.id);
    return getTx(t.id)!;
  });
}

export function createTopup(input: { userId: string; currency: string; amount: number; method: string; provider: string; idempotencyKey?: string | null }) {
  return tx(() => {
    if (input.idempotencyKey) {
      const existing = findByIdempotency(input.userId, input.idempotencyKey);
      if (existing) return existing;
    }
    requireActive(input.userId);
    ensureWallet(input.userId, input.currency);
    return createTx({
      type: 'topup', status: 'pending', user_id: input.userId, method: input.method, provider: input.provider, counterparty_name: input.provider,
      send_currency: input.currency, send_amount: input.amount, receive_currency: input.currency, receive_amount: input.amount,
      usd_value: usdValue(input.amount, input.currency), idempotency_key: input.idempotencyKey ?? null, provider_ref: newProviderRef(), provider_due_at: providerDueAt(),
    });
  });
}

/** Applies a provider's final answer. Safe to call repeatedly with the same result. */
export function settleProvider(t: TxRow, success: boolean, reason?: string) {
  tx(() => {
    const current = getTx(t.id)!;
    if (current.status !== 'pending') return;
    if (current.type === 'topup') {
      if (success) {
        post(current.id, [
          { account: systemAccount('external', current.send_currency), amount: -current.send_amount },
          { account: ensureWallet(current.user_id, current.send_currency), amount: current.send_amount },
        ]);
        setStatus(current.id, 'completed', { completed_at: now() });
        notify(current.user_id, 'topup', 'Money added', `${formatMoney(current.send_amount, current.send_currency)} was added to your wallet.`, current.id);
        rewardReferral(current.user_id, current.usd_value);
      } else {
        setStatus(current.id, 'failed', { failure_reason: reason ?? 'The payment was declined' });
        notify(current.user_id, 'topup_failed', 'Top-up failed', reason ?? 'The payment was declined.', current.id);
      }
    } else if (success) {
      settle(current);
    } else {
      releaseHold(current, reason ?? 'The payout partner could not deliver this transfer.');
    }
  });
}

export function exchange(input: { userId: string; sendCurrency: string; sendAmount: number; fee: number; rate: number; receiveCurrency: string; receiveAmount: number; idempotencyKey?: string | null }) {
  return tx(() => {
    if (input.idempotencyKey) {
      const existing = findByIdempotency(input.userId, input.idempotencyKey);
      if (existing) return existing;
    }
    requireActive(input.userId);
    const t = createTx({
      type: 'exchange', status: 'completed', user_id: input.userId, method: 'exchange', counterparty_name: `${input.sendCurrency} to ${input.receiveCurrency}`,
      send_currency: input.sendCurrency, send_amount: input.sendAmount, fee: input.fee, rate: input.rate, receive_currency: input.receiveCurrency, receive_amount: input.receiveAmount,
      usd_value: usdValue(input.sendAmount, input.sendCurrency), idempotency_key: input.idempotencyKey ?? null, completed_at: now(),
    });
    post(t.id, [
      { account: ensureWallet(input.userId, input.sendCurrency), amount: -(input.sendAmount + input.fee) },
      { account: systemAccount('fees', input.sendCurrency), amount: input.fee },
      { account: systemAccount('fx', input.sendCurrency), amount: input.sendAmount },
      { account: systemAccount('fx', input.receiveCurrency), amount: -input.receiveAmount },
      { account: ensureWallet(input.userId, input.receiveCurrency), amount: input.receiveAmount },
    ]);
    return getTx(t.id)!;
  });
}

export { priceFor };
