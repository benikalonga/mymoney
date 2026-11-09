import { randomUUID } from 'node:crypto';
import { db } from './db';
import { hashSecret } from './lib/auth';
import { fourDigits, newReferralCode, now } from './lib/ids';
import { ensureWallet, post, systemAccount } from './domain/ledger';
import { createTx, executeTransfer } from './services/transfers';
import { priceFor, usdValue } from './services/core';

/** Demo data for local development. Never run against production. */
const DEMO_PHONE = process.env.DEMO_PHONE ?? 'YOUR_PHONE_NUMBER';
const DEMO_PIN = process.env.DEMO_PIN ?? 'YOUR_PIN';
const DEMO_STAFF_EMAIL = 'YOUR_OWNER_EMAIL@fakeemail.com';
const DEMO_STAFF_PASSWORD = 'YOUR_PASSWORD';

const people = [
  { phone: DEMO_PHONE, first: 'YOUR_FIRST_NAME', last: 'YOUR_LAST_NAME', currency: 'ZAR', tier: 2, kyc: 'approved' },
  { phone: 'YOUR_PHONE_NUMBER_2', first: 'YOUR_FIRST_NAME_2', last: 'YOUR_LAST_NAME_2', currency: 'KES', tier: 1, kyc: 'none' },
  { phone: 'YOUR_PHONE_NUMBER_3', first: 'YOUR_FIRST_NAME_3', last: 'YOUR_LAST_NAME_3', currency: 'NGN', tier: 1, kyc: 'none' },
  { phone: 'YOUR_PHONE_NUMBER_4', first: 'YOUR_FIRST_NAME_4', last: 'YOUR_LAST_NAME_4', currency: 'GHS', tier: 1, kyc: 'none' },
];

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('The demo seed cannot run in production');
  if (!/^\+?[0-9]{8,15}$/.test(DEMO_PHONE) || !/^[0-9]{6}$/.test(DEMO_PIN)) throw new Error('Set DEMO_PHONE and DEMO_PIN (6 digits) in api/.env before seeding.');
  if (db.prepare('SELECT 1 FROM users LIMIT 1').get()) {
    console.log('The database already has data. Delete it to reseed.');
    return;
  }
  const pinHash = await hashSecret(DEMO_PIN);
  const ids: string[] = [];
  for (const p of people) {
    const id = randomUUID();
    ids.push(id);
    db.prepare(`INSERT INTO users (id, phone, first_name, last_name, tag, pin_hash, tier, kyc_status, default_currency, referral_code, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id, p.phone, p.first, p.last, `${p.first.toLowerCase()}${fourDigits()}`, pinHash, p.tier, p.kyc, p.currency, newReferralCode(), now());
    ensureWallet(id, p.currency);
    const perUsd = db.prepare('SELECT per_usd FROM rates WHERE currency = ?').pluck().get(p.currency) as number;
    const amount = Math.round(400_000 * perUsd);
    const t = createTx({ type: 'topup', status: 'completed', user_id: id, method: 'topup', provider: 'M-Pesa', counterparty_name: 'M-Pesa', send_currency: p.currency, send_amount: amount, receive_currency: p.currency, receive_amount: amount, usd_value: usdValue(amount, p.currency), completed_at: now() });
    post(t.id, [{ account: systemAccount('external', p.currency), amount: -amount }, { account: ensureWallet(id, p.currency), amount }]);
  }
  ensureWallet(ids[0], 'USD');

  const addRecipient = (userId: string, name: string, method: string, provider: string | null, account: string, currency: string, counterpartyId: string | null, favorite = 0) => {
    const id = randomUUID();
    db.prepare('INSERT INTO recipients (id, user_id, name, method, provider, account, currency, counterparty_id, favorite, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(id, userId, name, method, provider, account, currency, counterpartyId, favorite, now());
    return { id, name, method: method as 'mymoney' | 'mobile_money' | 'bank', provider, account, currency, counterpartyId };
  };
  const recipients = [
    addRecipient(ids[0], 'YOUR_FIRST_NAME_2 YOUR_LAST_NAME_2', 'mymoney', null, db.prepare('SELECT tag FROM users WHERE id = ?').pluck().get(ids[1]) as string, 'KES', ids[1], 1),
    addRecipient(ids[0], 'YOUR_RECIPIENT_NAME', 'mobile_money', 'M-Pesa', 'YOUR_MOBILE_NUMBER', 'KES', null),
    addRecipient(ids[0], 'YOUR_RECIPIENT_NAME_2', 'bank', 'Absa', 'YOUR_ACCOUNT_NUMBER', 'ZAR', null),
  ];
  const categories = ['family', 'bills', 'school', 'family', 'business'];
  recipients.concat(recipients.slice(0, 2)).forEach((r, i) => {
    const p = priceFor(r.method, 'ZAR', r.currency, { sendAmount: 25_000 + i * 15_000 });
    executeTransfer({ userId: ids[0], method: r.method, sendCurrency: 'ZAR', sendAmount: p.sendAmount, fee: p.fee, rate: p.rate, receiveCurrency: r.currency, receiveAmount: p.receiveAmount, counterpartyId: r.counterpartyId, counterpartyName: r.name, recipientId: r.id, provider: r.provider, payoutAccount: r.method === 'mymoney' ? null : r.account, category: categories[i], idempotencyKey: `seed-${i}` });
  });
  db.prepare("UPDATE transactions SET provider_due_at = ? WHERE status = 'pending'").run(now());
  // Spread the history over past days, so the demo starts clear of the rapid-transfer rule.
  const history = db.prepare("SELECT id FROM transactions WHERE type = 'transfer' ORDER BY rowid").pluck().all() as string[];
  history.forEach((id, i) => {
    const when = new Date(Date.now() - (history.length - i) * 2 * 86_400_000).toISOString();
    db.prepare('UPDATE transactions SET created_at = ?, completed_at = COALESCE(completed_at, ?) WHERE id = ?').run(when, when, id);
  });

  db.prepare("INSERT INTO money_requests (id, requester_id, payer_id, currency, amount, note, status, expires_at, created_at) VALUES (?,?,?,?,?,?,'pending',?,?)")
    .run(randomUUID(), ids[1], ids[0], 'KES', 150_000, 'Share of the electricity bill', new Date(Date.now() + 10 * 86_400_000).toISOString(), now());
  db.prepare("INSERT INTO kyc_submissions (id, user_id, legal_name, date_of_birth, document_type, document_number, address, status, created_at) VALUES (?,?,?,?,?,?,?,'pending',?)")
    .run(randomUUID(), ids[2], 'YOUR_LEGAL_NAME', 'YOUR_DATE_OF_BIRTH', 'national_id', 'YOUR_DOCUMENT_NUMBER', 'YOUR_ADDRESS', now());
  db.prepare("UPDATE users SET kyc_status = 'pending' WHERE id = ?").run(ids[2]);

  db.prepare("INSERT INTO staff (id, email, name, password_hash, role, created_at) VALUES (?,?,?,?,'owner',?)").run(randomUUID(), DEMO_STAFF_EMAIL.toLowerCase(), 'YOUR_OWNER_NAME', await hashSecret(DEMO_STAFF_PASSWORD), now());

  console.log('Seeded demo data.');
  console.log('  Customer: your DEMO_PHONE and DEMO_PIN');
  console.log(`  Console:   ${DEMO_STAFF_EMAIL} / ${DEMO_STAFF_PASSWORD}`);
}
void main();
