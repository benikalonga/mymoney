import type { TxRow, UserRow } from './core';

export function presentUser(u: UserRow) {
  return {
    id: u.id, phone: u.phone, firstName: u.first_name, lastName: u.last_name, email: u.email, tag: u.tag, status: u.status, tier: u.tier,
    kycStatus: u.kyc_status, defaultCurrency: u.default_currency, referralCode: u.referral_code, createdAt: u.created_at,
  };
}

function mask(account: string | null) {
  if (!account) return null;
  return account.length <= 4 ? account : `•••• ${account.slice(-4)}`;
}

/** A transaction as one participant sees it. The receiver never sees the sender's fee or wallet details. */
export function presentTx(t: TxRow, viewerId: string, senderName?: string) {
  const incoming = t.user_id !== viewerId;
  const inflow = incoming || t.type === 'topup' || t.type === 'bonus' || t.type === 'pot_withdrawal';
  return {
    id: t.id, reference: t.reference, type: t.type, status: t.status, direction: inflow ? 'in' : 'out', method: t.method, provider: t.provider,
    counterpartyName: incoming ? senderName ?? 'MyMoney user' : t.counterparty_name,
    account: incoming ? null : mask(t.payout_account),
    recipientId: incoming ? null : t.recipient_id,
    sendCurrency: incoming ? t.receive_currency : t.send_currency,
    sendAmount: incoming ? t.receive_amount : t.send_amount,
    fee: incoming ? 0 : t.fee,
    rate: incoming ? 1 : t.rate,
    receiveCurrency: t.receive_currency,
    receiveAmount: t.receive_amount,
    note: t.note, category: incoming ? null : t.category, failureReason: t.failure_reason, createdAt: t.created_at, completedAt: t.completed_at,
  };
}
