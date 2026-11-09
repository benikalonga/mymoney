import './testEnv';
import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';
import { createApp } from './app';
import { db } from './db';
import { ledgerHealth } from './domain/ledger';
import { hashSecret } from './lib/auth';
import { signPayload } from './routes/webhooks';
import { tick } from './services/jobs';

let server: Server;
let base = '';
let phoneSeq = 700000000;
let ownerToken = '';
let agentToken = '';

type Res = { status: number; body: any };
async function call(method: string, path: string, body?: unknown, token?: string, headers: Record<string, string> = {}): Promise<Res> {
  const res = await fetch(`${base}/v1${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: any = text;
  try { parsed = JSON.parse(text); } catch { /* CSV responses stay as text */ }
  return { status: res.status, body: parsed };
}

const randomPin = (): string => {
  const pin = String(randomInt(200000, 900000));
  return /^(\d)\1+$/.test(pin) || pin === '654321' ? randomPin() : pin;
};
let fakeSeq = 0;
const fakePhone = () => `+1555${1000000 + ++fakeSeq}`;
const PIN = randomPin();
const NEW_PIN = randomPin();
const key = () => randomUUID();

interface Person { token: string; id: string; phone: string; tag: string; referralCode: string }

async function register(currency = 'USD', extra: object = {}): Promise<Person> {
  const phone = `+1555${++phoneSeq}`;
  const r = await call('POST', '/auth/register', { phone, pin: PIN, firstName: 'Test', lastName: 'User', currency, ...extra });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return { token: r.body.token, id: r.body.user.id, phone, tag: r.body.user.tag, referralCode: r.body.user.referralCode };
}

async function fund(p: Person, amount: number, currency = 'USD') {
  const r = await call('POST', '/topups', { currency, amount, provider: 'M-Pesa', idempotencyKey: key() }, p.token);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  tick();
  return r.body;
}

async function funded(amount: number, currency = 'USD') {
  const p = await register(currency);
  await fund(p, amount, currency);
  return p;
}

async function balance(p: Person, currency = 'USD') {
  const r = await call('GET', '/wallets', undefined, p.token);
  return r.body.wallets.find((w: any) => w.currency === currency)?.balance ?? 0;
}

async function addP2P(from: Person, to: Person, currency = 'USD') {
  const r = await call('POST', '/recipients', { method: 'mymoney', account: to.phone, currency }, from.token);
  assert.ok(r.status < 300, JSON.stringify(r.body));
  return r.body;
}

async function addPayout(from: Person, account = '100000111222', method = 'mobile_money', currency = 'KES') {
  const r = await call('POST', '/recipients', { name: 'Payout Person', method, provider: method === 'bank' ? 'Absa' : 'M-Pesa', account, currency }, from.token);
  assert.ok(r.status < 300, JSON.stringify(r.body));
  return r.body;
}

async function quote(p: Person, recipientId: string, sendAmount: number, sendCurrency = 'USD') {
  const r = await call('POST', '/quotes', { recipientId, sendCurrency, sendAmount }, p.token);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body;
}

async function send(p: Person, recipientId: string, amount: number, sendCurrency = 'USD') {
  const q = await quote(p, recipientId, amount, sendCurrency);
  return call('POST', '/transfers', { quoteId: q.id, pin: PIN, idempotencyKey: key() }, p.token);
}

async function staff(email: string, role: string, name: string) {
  const password = 'YOUR_PASSWORD';
  db.prepare('INSERT INTO staff (id, email, name, password_hash, role, created_at) VALUES (?,?,?,?,?,?)').run(randomUUID(), email, name, await hashSecret(password), role, new Date().toISOString());
  const r = await call('POST', '/admin/auth/login', { email, password });
  assert.equal(r.status, 200);
  return r.body.token as string;
}

function assertHealthy() {
  const health = ledgerHealth();
  assert.equal(health.healthy, true, JSON.stringify(health));
}

before(async () => {
  server = createApp().listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  ownerToken = await staff('owner@fakeemail.com', 'owner', 'YOUR_OWNER_NAME');
  agentToken = await staff('agent@fakeemail.com', 'agent', 'YOUR_AGENT_NAME');
});
after(() => { assertHealthy(); server.close(); });

describe('accounts and sign-in', () => {
  test('registers, opens a wallet and returns no secrets', async () => {
    const r = await call('POST', '/auth/register', { phone: ['+1', '555', '000', '0101'].join(' '), pin: PIN, firstName: 'YOUR_FIRST_NAME', lastName: 'YOUR_LAST_NAME', currency: 'ZAR' });
    assert.equal(r.status, 201);
    assert.equal(r.body.user.phone, ['+1', '555', '000', '0101'].join(''));
    assert.equal(JSON.stringify(r.body).includes('pin'), false);
    const w = await call('GET', '/wallets', undefined, r.body.token);
    assert.deepEqual(w.body.wallets.map((x: any) => x.currency), ['ZAR']);
  });
  test('rejects duplicate phones, weak PINs, bad phones and unknown currencies', async () => {
    const p = await register();
    assert.equal((await call('POST', '/auth/register', { phone: p.phone, pin: PIN, firstName: 'A', lastName: 'B' })).status, 409);
    assert.equal((await call('POST', '/auth/register', { phone: fakePhone(), pin: '123456', firstName: 'A', lastName: 'B' })).body.error.code, 'WEAK_PIN');
    assert.equal((await call('POST', '/auth/register', { phone: 'abc', pin: PIN, firstName: 'A', lastName: 'B' })).status, 422);
    assert.equal((await call('POST', '/auth/register', { phone: fakePhone(), pin: PIN, firstName: 'A', lastName: 'B', currency: 'XXX' })).body.error.code, 'UNSUPPORTED_CURRENCY');
  });
  test('wrong credentials look the same for known and unknown numbers', async () => {
    const p = await register();
    const known = await call('POST', '/auth/login', { phone: p.phone, pin: '000001' });
    const unknown = await call('POST', '/auth/login', { phone: fakePhone(), pin: '000001' });
    assert.equal(known.status, 401);
    assert.deepEqual(known.body, unknown.body);
  });
  test('locks after five wrong PINs, even for the right PIN', async () => {
    const p = await register();
    for (let i = 0; i < 4; i++) assert.equal((await call('POST', '/auth/login', { phone: p.phone, pin: '999990' })).status, 401);
    assert.equal((await call('POST', '/auth/login', { phone: p.phone, pin: '999990' })).status, 423);
    assert.equal((await call('POST', '/auth/login', { phone: p.phone, pin: PIN })).status, 423);
    assert.equal((await call('POST', `/admin/users/${p.id}/unlock`, {}, agentToken)).status, 200);
    assert.equal((await call('POST', '/auth/login', { phone: p.phone, pin: PIN })).status, 200);
  });
  test('rejects missing, garbage and staff tokens on customer routes', async () => {
    assert.equal((await call('GET', '/me')).status, 401);
    assert.equal((await call('GET', '/me', undefined, 'garbage')).status, 401);
    assert.equal((await call('GET', '/me', undefined, agentToken)).status, 401);
  });
  test('customer tokens cannot reach the console', async () => {
    const p = await register();
    assert.equal((await call('GET', '/admin/overview', undefined, p.token)).status, 401);
  });
  test('logout and session revocation end access', async () => {
    const p = await register();
    const second = await call('POST', '/auth/login', { phone: p.phone, pin: PIN, device: 'Tablet' });
    const list = await call('GET', '/sessions', undefined, p.token);
    assert.equal(list.body.length, 2);
    const other = list.body.find((s: any) => !s.current);
    await call('DELETE', `/sessions/${other.id}`, undefined, p.token);
    assert.equal((await call('GET', '/me', undefined, second.body.token)).status, 401);
    await call('POST', '/auth/logout', {}, p.token);
    assert.equal((await call('GET', '/me', undefined, p.token)).status, 401);
  });
  test('changing the PIN signs out other devices', async () => {
    const p = await register();
    const second = await call('POST', '/auth/login', { phone: p.phone, pin: PIN });
    assert.equal((await call('POST', '/auth/pin', { currentPin: '900009', newPin: NEW_PIN }, p.token)).status, 401);
    assert.equal((await call('POST', '/auth/pin', { currentPin: PIN, newPin: NEW_PIN }, p.token)).status, 200);
    assert.equal((await call('GET', '/me', undefined, second.body.token)).status, 401);
    assert.equal((await call('POST', '/auth/login', { phone: p.phone, pin: NEW_PIN })).status, 200);
  });
  test('updates the profile and enforces unique tags', async () => {
    const a = await register();
    const b = await register();
    const ok = await call('PATCH', '/me', { tag: `tag${phoneSeq}`, email: 'x@fakeemail.com' }, a.token);
    assert.equal(ok.status, 200);
    assert.equal(ok.body.email, 'x@fakeemail.com');
    assert.equal((await call('PATCH', '/me', { tag: ok.body.tag }, b.token)).status, 409);
  });
});

describe('top-ups and provider webhooks', () => {
  test('a sandbox top-up credits the wallet once', async () => {
    const p = await register();
    const t = await fund(p, 5000);
    assert.equal(t.status, 'pending');
    assert.equal(await balance(p), 5000);
    tick();
    assert.equal(await balance(p), 5000);
  });
  test('the same idempotency key does not create two top-ups', async () => {
    const p = await register();
    const k = key();
    const one = await call('POST', '/topups', { currency: 'USD', amount: 1000, provider: 'M-Pesa', idempotencyKey: k }, p.token);
    const two = await call('POST', '/topups', { currency: 'USD', amount: 1000, provider: 'M-Pesa', idempotencyKey: k }, p.token);
    assert.equal(one.body.id, two.body.id);
    tick();
    assert.equal(await balance(p), 1000);
  });

  async function pendingTopup(p: Person, amount: number) {
    db.prepare("UPDATE transactions SET provider_due_at = NULL WHERE status = 'pending'").run();
    const r = await call('POST', '/topups', { currency: 'USD', amount, provider: 'M-Pesa', idempotencyKey: key() }, p.token);
    db.prepare('UPDATE transactions SET provider_due_at = NULL WHERE id = ?').run(r.body.id);
    return db.prepare('SELECT provider_ref FROM transactions WHERE id = ?').pluck().get(r.body.id) as string;
  }
  const hook = (payload: object, signature?: string) => {
    const raw = JSON.stringify(payload);
    return fetch(`${base}/v1/webhooks/provider`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Signature': signature ?? signPayload(raw) }, body: raw });
  };

  test('webhooks need a valid signature', async () => {
    const p = await register();
    const ref = await pendingTopup(p, 2000);
    assert.equal((await hook({ providerRef: ref, status: 'success', amount: 2000 }, 'forged')).status, 401);
    assert.equal(await balance(p), 0);
  });
  test('webhooks reject a mismatched amount and credit only once', async () => {
    const p = await register();
    const ref = await pendingTopup(p, 2000);
    assert.equal((await hook({ providerRef: ref, status: 'success', amount: 999999 })).status, 422);
    assert.equal((await hook({ providerRef: ref, status: 'success', amount: 2000 })).status, 200);
    assert.equal((await hook({ providerRef: ref, status: 'success', amount: 2000 })).status, 200);
    assert.equal(await balance(p), 2000);
  });
  test('a failed webhook leaves the balance alone', async () => {
    const p = await register();
    const ref = await pendingTopup(p, 2000);
    assert.equal((await hook({ providerRef: ref, status: 'failed', reason: 'Declined' })).status, 200);
    assert.equal(await balance(p), 0);
  });
});

describe('sending money', () => {
  test('same-currency sends move the exact amount with no fee', async () => {
    const a = await funded(10_000);
    const b = await register();
    const rec = await addP2P(a, b);
    const r = await send(a, rec.id, 2_500);
    assert.equal(r.status, 201);
    assert.equal(r.body.status, 'completed');
    assert.equal(await balance(a), 7_500);
    assert.equal(await balance(b), 2_500);
  });
  test('cross-currency sends use the quoted rate and open a wallet', async () => {
    const a = await funded(10_000);
    const b = await register('ZAR');
    const rec = await addP2P(a, b, 'KES');
    const q = await quote(a, rec.id, 1_000);
    assert.ok(q.rate > 120 && q.rate < 129);
    await call('POST', '/transfers', { quoteId: q.id, pin: PIN, idempotencyKey: key() }, a.token);
    assert.equal(await balance(b, 'KES'), q.receiveAmount);
    assertHealthy();
  });
  test('quotes can be priced from the amount received', async () => {
    const a = await funded(10_000);
    const rec = await addPayout(a);
    const r = await call('POST', '/quotes', { recipientId: rec.id, sendCurrency: 'USD', receiveAmount: 100_000 }, a.token);
    assert.equal(r.body.receiveAmount, 100_000);
    assert.ok(r.body.sendAmount > 0);
  });
  test('quotes need exactly one amount', async () => {
    const a = await funded(1_000);
    const rec = await addPayout(a);
    assert.equal((await call('POST', '/quotes', { recipientId: rec.id, sendCurrency: 'USD' }, a.token)).status, 422);
    assert.equal((await call('POST', '/quotes', { recipientId: rec.id, sendCurrency: 'USD', sendAmount: 1, receiveAmount: 1 }, a.token)).status, 422);
  });
  test('rejects negative, zero and fractional amounts', async () => {
    const a = await funded(1_000);
    const rec = await addPayout(a);
    for (const sendAmount of [-100, 0, 10.5]) assert.equal((await call('POST', '/quotes', { recipientId: rec.id, sendCurrency: 'USD', sendAmount }, a.token)).status, 422);
  });
  test('insufficient funds leaves everything untouched and the quote reusable', async () => {
    const a = await funded(1_000);
    const b = await register();
    const rec = await addP2P(a, b);
    const q = await quote(a, rec.id, 5_000);
    const r = await call('POST', '/transfers', { quoteId: q.id, pin: PIN, idempotencyKey: key() }, a.token);
    assert.equal(r.body.error.code, 'INSUFFICIENT_FUNDS');
    assert.equal(await balance(a), 1_000);
    assert.equal(db.prepare('SELECT used_at FROM quotes WHERE id = ?').pluck().get(q.id), null);
  });
  test('a wrong PIN blocks the transfer', async () => {
    const a = await funded(1_000);
    const b = await register();
    const rec = await addP2P(a, b);
    const q = await quote(a, rec.id, 100);
    assert.equal((await call('POST', '/transfers', { quoteId: q.id, pin: '101010', idempotencyKey: key() }, a.token)).body.error.code, 'WRONG_PIN');
    assert.equal(await balance(a), 1_000);
  });
  test('quotes are single use, expire, and belong to their owner', async () => {
    const a = await funded(5_000);
    const b = await funded(5_000);
    const c = await register();
    const rec = await addP2P(a, c);
    const q = await quote(a, rec.id, 100);
    assert.equal((await call('POST', '/transfers', { quoteId: q.id, pin: PIN, idempotencyKey: key() }, b.token)).status, 404);
    assert.equal((await call('POST', '/transfers', { quoteId: q.id, pin: PIN, idempotencyKey: key() }, a.token)).status, 201);
    assert.equal((await call('POST', '/transfers', { quoteId: q.id, pin: PIN, idempotencyKey: key() }, a.token)).body.error.code, 'QUOTE_USED');
    const stale = await quote(a, rec.id, 100);
    db.prepare("UPDATE quotes SET expires_at = '2000-01-01T00:00:00.000Z' WHERE id = ?").run(stale.id);
    assert.equal((await call('POST', '/transfers', { quoteId: stale.id, pin: PIN, idempotencyKey: key() }, a.token)).body.error.code, 'QUOTE_EXPIRED');
  });
  test('retrying with the same key returns the same transfer', async () => {
    const a = await funded(5_000);
    const b = await register();
    const rec = await addP2P(a, b);
    const k = key();
    const q1 = await quote(a, rec.id, 1_000);
    const q2 = await quote(a, rec.id, 1_000);
    const one = await call('POST', '/transfers', { quoteId: q1.id, pin: PIN, idempotencyKey: k }, a.token);
    const two = await call('POST', '/transfers', { quoteId: q2.id, pin: PIN, idempotencyKey: k }, a.token);
    assert.equal(one.status, 201);
    assert.equal(two.status, 200);
    assert.equal(one.body.id, two.body.id);
    assert.equal(await balance(a), 4_000);
  });
  test('concurrent retries with one key move money once', async () => {
    const a = await funded(5_000);
    const b = await register();
    const rec = await addP2P(a, b);
    const k = key();
    const quotes = await Promise.all(Array.from({ length: 8 }, () => quote(a, rec.id, 1_000)));
    const results = await Promise.all(quotes.map((q) => call('POST', '/transfers', { quoteId: q.id, pin: PIN, idempotencyKey: k }, a.token)));
    assert.equal(new Set(results.map((r) => r.body.id)).size, 1);
    assert.equal(await balance(a), 4_000);
    assert.equal(await balance(b), 1_000);
  });
  test('concurrent sends can never overspend a wallet', async () => {
    const a = await funded(10_000);
    const b = await register();
    const rec = await addP2P(a, b);
    const quotes = await Promise.all(Array.from({ length: 25 }, () => quote(a, rec.id, 1_000)));
    const results = await Promise.all(quotes.map((q) => call('POST', '/transfers', { quoteId: q.id, pin: PIN, idempotencyKey: key() }, a.token)));
    const ok = results.filter((r) => r.status === 201);
    assert.equal(ok.length, 10);
    assert.equal(results.filter((r) => r.body.error?.code === 'INSUFFICIENT_FUNDS').length, 15);
    assert.equal(await balance(a), 0);
    assertHealthy();
  });
  test('cannot add yourself or an unknown user', async () => {
    const a = await register();
    assert.equal((await call('POST', '/recipients', { method: 'mymoney', account: a.phone, currency: 'USD' }, a.token)).status, 422);
    assert.equal((await call('POST', '/recipients', { method: 'mymoney', account: fakePhone(), currency: 'USD' }, a.token)).body.error.code, 'USER_NOT_FOUND');
  });
  test('per-transfer, daily limits apply and reversed sends free them', async () => {
    const a = await funded(1_000_000);
    const b = await register();
    const rec = await addP2P(a, b);
    assert.equal((await send(a, rec.id, 50_001)).body.error.code, 'LIMIT_EXCEEDED');
    assert.equal((await send(a, rec.id, 50_000)).status, 201);
    const second = await send(a, rec.id, 50_000);
    assert.equal(second.status, 201);
    assert.equal((await send(a, rec.id, 100)).body.error.code, 'LIMIT_EXCEEDED');
    assert.equal((await call('POST', `/admin/transactions/${second.body.id}/reverse`, { reason: 'Customer error' }, ownerToken)).status, 200);
    assert.equal((await send(a, rec.id, 100)).status, 201);
  });
  test('frozen accounts cannot send or receive, but can read', async () => {
    const a = await funded(5_000);
    const b = await register();
    const c = await funded(5_000);
    const toB = await addP2P(a, b);
    const cToA = await addP2P(c, a);
    await call('PATCH', `/admin/users/${a.id}`, { status: 'frozen', reason: 'Fraud check' }, agentToken);
    assert.equal((await send(a, toB.id, 100)).status, 403);
    assert.equal((await send(c, cToA.id, 100)).status, 403);
    assert.equal((await call('GET', '/wallets', undefined, a.token)).status, 200);
    await call('PATCH', `/admin/users/${a.id}`, { status: 'active', reason: 'Cleared' }, agentToken);
    assert.equal((await send(a, toB.id, 100)).status, 201);
  });
  test('payouts hold funds, charge a fee and complete', async () => {
    const a = await funded(10_000);
    const rec = await addPayout(a);
    db.exec("UPDATE rates SET per_usd = per_usd");
    const q = await quote(a, rec.id, 2_000);
    assert.equal(q.fee, 30);
    const r = await call('POST', '/transfers', { quoteId: q.id, pin: PIN, idempotencyKey: key() }, a.token);
    assert.equal(r.body.status, 'pending');
    assert.equal(await balance(a), 7_970);
    tick();
    assert.equal((await call('GET', `/transactions/${r.body.id}`, undefined, a.token)).body.status, 'completed');
    assert.equal(await balance(a), 7_970);
    assertHealthy();
  });
  test('a failed payout refunds the amount and the fee', async () => {
    const a = await funded(10_000);
    const rec = await addPayout(a, '100000110000');
    const r = await send(a, rec.id, 2_000);
    assert.equal(await balance(a), 7_970);
    tick();
    const t = await call('GET', `/transactions/${r.body.id}`, undefined, a.token);
    assert.equal(t.body.status, 'failed');
    assert.ok(t.body.failureReason);
    assert.equal(await balance(a), 10_000);
    assertHealthy();
  });
  test('other customers cannot see a transaction, and receivers do not see fees', async () => {
    const a = await funded(10_000);
    const b = await register();
    const c = await register();
    const rec = await addP2P(a, b);
    const r = await send(a, rec.id, 1_000);
    assert.equal((await call('GET', `/transactions/${r.body.id}`, undefined, c.token)).status, 404);
    const seen = await call('GET', `/transactions/${r.body.id}`, undefined, b.token);
    assert.equal(seen.body.direction, 'in');
    assert.equal(seen.body.fee, 0);
    assert.equal(seen.body.counterpartyName, 'Test User');
  });
  test('search and filters on history, including wildcards', async () => {
    const a = await funded(10_000);
    const b = await register();
    const rec = await addP2P(a, b);
    const q = await quote(a, rec.id, 100);
    const sent = await call('POST', '/transfers', { quoteId: q.id, pin: PIN, idempotencyKey: key(), note: 'school fees' }, a.token);
    assert.equal((await call('GET', '/transactions?q=school', undefined, a.token)).body.total, 1);
    assert.equal((await call('GET', `/transactions?q=${sent.body.reference}`, undefined, a.token)).body.total, 1);
    assert.equal((await call('GET', `/transactions?q=${encodeURIComponent('%')}`, undefined, a.token)).body.total, 0);
    assert.equal((await call('GET', '/transactions?type=topup', undefined, a.token)).body.total, 1);
    assert.equal((await call('GET', '/transactions?direction=in', undefined, b.token)).body.total, 1);
  });
});

describe('staff review', () => {
  async function reviewed() {
    const a = await funded(1_000_000);
    await call('POST', `/kyc`, { legalName: 'Test User', dateOfBirth: '1990-02-02', documentType: 'passport', documentNumber: 'A123456', address: '1 Long Street' }, a.token);
    const k = db.prepare("SELECT id FROM kyc_submissions WHERE user_id = ?").pluck().get(a.id);
    await call('POST', `/admin/kyc/${k}`, { decision: 'approved' }, agentToken);
    const b = await register();
    const rec = await addP2P(a, b);
    const r = await send(a, rec.id, 300_000);
    assert.equal(r.status, 201);
    assert.equal(r.body.status, 'review');
    return { a, b, id: r.body.id };
  }
  test('large transfers wait, and funds are held', async () => {
    const { a, b } = await reviewed();
    assert.equal(await balance(a), 700_000);
    assert.equal(await balance(b), 0);
  });
  test('approval delivers, and cannot be applied twice', async () => {
    const { b, id } = await reviewed();
    assert.equal((await call('POST', `/admin/transactions/${id}/approve`, {}, agentToken)).body.status, 'completed');
    assert.equal(await balance(b), 300_000);
    assert.equal((await call('POST', `/admin/transactions/${id}/approve`, {}, agentToken)).status, 409);
    assert.equal((await call('POST', `/admin/transactions/${id}/reject`, { reason: 'Late' }, agentToken)).status, 409);
    assert.equal(await balance(b), 300_000);
  });
  test('rejection refunds and needs a reason', async () => {
    const { a, b, id } = await reviewed();
    assert.equal((await call('POST', `/admin/transactions/${id}/reject`, {}, agentToken)).status, 422);
    assert.equal((await call('POST', `/admin/transactions/${id}/reject`, { reason: 'Could not verify' }, agentToken)).body.status, 'failed');
    assert.equal(await balance(a), 1_000_000);
    assert.equal(await balance(b), 0);
    assertHealthy();
  });
  test('many quick transfers trigger review', async () => {
    const a = await funded(10_000);
    const b = await register();
    const rec = await addP2P(a, b);
    for (let i = 0; i < 5; i++) assert.equal((await send(a, rec.id, 100)).body.status, 'completed');
    assert.equal((await send(a, rec.id, 100)).body.status, 'review');
  });
});

describe('reversals', () => {
  test('owners can reverse a cross-currency transfer exactly', async () => {
    const a = await funded(10_000);
    const b = await register();
    const rec = await addP2P(a, b, 'ZAR');
    const r = await send(a, rec.id, 1_000);
    assert.equal((await call('POST', `/admin/transactions/${r.body.id}/reverse`, { reason: 'Wrong person' }, ownerToken)).body.status, 'reversed');
    assert.equal(await balance(a), 10_000);
    assert.equal(await balance(b, 'ZAR'), 0);
    assertHealthy();
  });
  test('agents cannot reverse, and nothing is reversed twice', async () => {
    const a = await funded(10_000);
    const b = await register();
    const rec = await addP2P(a, b);
    const r = await send(a, rec.id, 1_000);
    assert.equal((await call('POST', `/admin/transactions/${r.body.id}/reverse`, { reason: 'Nope' }, agentToken)).status, 403);
    assert.equal((await call('POST', `/admin/transactions/${r.body.id}/reverse`, { reason: 'First' }, ownerToken)).status, 200);
    assert.equal((await call('POST', `/admin/transactions/${r.body.id}/reverse`, { reason: 'Again' }, ownerToken)).status, 409);
    assert.equal(await balance(a), 10_000);
  });
  test('a reversal fails cleanly when the recipient spent the money', async () => {
    const a = await funded(10_000);
    const b = await register();
    const c = await register();
    const rec = await addP2P(a, b);
    const onward = await addP2P(b, c);
    const r = await send(a, rec.id, 1_000);
    await send(b, onward.id, 1_000);
    const res = await call('POST', `/admin/transactions/${r.body.id}/reverse`, { reason: 'Wrong person' }, ownerToken);
    assert.equal(res.body.error.code, 'FUNDS_SPENT');
    assert.equal(await balance(a), 9_000);
    assert.equal((await call('GET', `/transactions/${r.body.id}`, undefined, a.token)).body.status, 'completed');
  });
});

describe('exchange', () => {
  test('converts between own wallets with a fee', async () => {
    const a = await funded(10_000);
    const q = await call('POST', '/quotes', { method: 'exchange', sendCurrency: 'USD', receiveCurrency: 'EUR', sendAmount: 1_000 }, a.token);
    assert.equal(q.body.fee, 5);
    const r = await call('POST', '/exchange', { quoteId: q.body.id, pin: PIN, idempotencyKey: key() }, a.token);
    assert.equal(r.status, 201);
    assert.equal(await balance(a), 8_995);
    assert.equal(await balance(a, 'EUR'), q.body.receiveAmount);
    assertHealthy();
  });
  test('refuses same-currency exchange, send quotes and missing wallets', async () => {
    const a = await funded(1_000);
    assert.equal((await call('POST', '/quotes', { method: 'exchange', sendCurrency: 'USD', receiveCurrency: 'USD', sendAmount: 100 }, a.token)).status, 422);
    const b = await register();
    const rec = await addP2P(a, b);
    const sendQuote = await quote(a, rec.id, 100);
    assert.equal((await call('POST', '/exchange', { quoteId: sendQuote.id, pin: PIN, idempotencyKey: key() }, a.token)).status, 404);
    const eur = await call('POST', '/quotes', { method: 'exchange', sendCurrency: 'EUR', receiveCurrency: 'USD', sendAmount: 100 }, a.token);
    assert.equal((await call('POST', '/exchange', { quoteId: eur.body.id, pin: PIN, idempotencyKey: key() }, a.token)).body.error.code, 'INSUFFICIENT_FUNDS');
  });
});

describe('payment requests', () => {
  async function request(from: Person, to: Person, amount = 1_500, currency = 'USD') {
    const r = await call('POST', '/requests', { payer: to.tag, currency, amount, note: 'Lunch' }, from.token);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    return r.body;
  }
  test('paying a request moves the money once', async () => {
    const asker = await register();
    const payer = await funded(5_000);
    const r = await request(asker, payer);
    assert.equal((await call('GET', '/requests?box=incoming', undefined, payer.token)).body[0].otherName, 'Test User');
    assert.equal((await call('POST', `/requests/${r.id}/pay`, { pin: PIN, idempotencyKey: key() }, payer.token)).status, 201);
    assert.equal(await balance(asker), 1_500);
    assert.equal(await balance(payer), 3_500);
    assert.equal((await call('POST', `/requests/${r.id}/pay`, { pin: PIN, idempotencyKey: key() }, payer.token)).status, 409);
    assert.equal(await balance(payer), 3_500);
  });
  test('can pay from another currency and deliver the exact amount', async () => {
    const asker = await register('ZAR');
    const payer = await funded(5_000);
    const r = await request(asker, payer, 18_000, 'ZAR');
    assert.equal((await call('POST', `/requests/${r.id}/pay`, { pin: PIN, idempotencyKey: key(), fromCurrency: 'USD' }, payer.token)).status, 201);
    assert.equal(await balance(asker, 'ZAR'), 18_000);
  });
  test('only the payer can pay or decline, only the asker can cancel', async () => {
    const asker = await funded(1_000);
    const payer = await funded(1_000);
    const r = await request(asker, payer);
    assert.equal((await call('POST', `/requests/${r.id}/pay`, { pin: PIN, idempotencyKey: key() }, asker.token)).status, 404);
    assert.equal((await call('POST', `/requests/${r.id}/decline`, {}, asker.token)).status, 404);
    assert.equal((await call('POST', `/requests/${r.id}/cancel`, {}, payer.token)).status, 404);
    assert.equal((await call('POST', `/requests/${r.id}/decline`, {}, payer.token)).body.status, 'declined');
    assert.equal((await call('POST', `/requests/${r.id}/cancel`, {}, asker.token)).status, 409);
  });
  test('expired requests close and cannot be paid', async () => {
    const asker = await register();
    const payer = await funded(5_000);
    const r = await request(asker, payer);
    db.prepare("UPDATE money_requests SET expires_at = '2000-01-01T00:00:00.000Z' WHERE id = ?").run(r.id);
    tick();
    assert.equal((await call('POST', `/requests/${r.id}/pay`, { pin: PIN, idempotencyKey: key() }, payer.token)).status, 409);
    assert.equal(await balance(payer), 5_000);
  });
  test('a rejected payment reopens the request', async () => {
    const asker = await register();
    const payer = await funded(10_000);
    const r = await request(asker, payer);
    db.prepare("UPDATE transactions SET created_at = created_at").run();
    for (let i = 0; i < 5; i++) {
      const filler = await addP2P(payer, asker);
      await send(payer, filler.id, 1);
    }
    const paid = await call('POST', `/requests/${r.id}/pay`, { pin: PIN, idempotencyKey: key() }, payer.token);
    assert.equal(paid.body.status, 'review');
    await call('POST', `/admin/transactions/${paid.body.id}/reject`, { reason: 'Could not verify' }, agentToken);
    const incoming = await call('GET', '/requests?box=incoming', undefined, payer.token);
    assert.equal(incoming.body.find((x: any) => x.id === r.id).status, 'pending');
  });
});

describe('savings goals', () => {
  test('deposits, withdrawals and closing move money correctly', async () => {
    const a = await funded(10_000);
    const pot = await call('POST', '/pots', { name: 'New roof', target: 50_000, currency: 'USD', targetDate: '2028-01-01' }, a.token);
    assert.equal(pot.status, 201);
    const k = key();
    const dep = await call('POST', `/pots/${pot.body.id}/deposit`, { amount: 4_000, idempotencyKey: k }, a.token);
    assert.equal(dep.body.balance, 4_000);
    assert.equal(dep.body.progress, 0.08);
    assert.equal((await call('POST', `/pots/${pot.body.id}/deposit`, { amount: 4_000, idempotencyKey: k }, a.token)).body.balance, 4_000);
    assert.equal(await balance(a), 6_000);
    await call('POST', `/pots/${pot.body.id}/withdraw`, { amount: 1_000, idempotencyKey: key() }, a.token);
    assert.equal(await balance(a), 7_000);
    assert.equal((await call('POST', `/pots/${pot.body.id}/withdraw`, { amount: 99_999, idempotencyKey: key() }, a.token)).body.error.code, 'INSUFFICIENT_FUNDS');
    const closed = await call('DELETE', `/pots/${pot.body.id}`, undefined, a.token);
    assert.equal(closed.body.returned, 3_000);
    assert.equal(await balance(a), 10_000);
    assert.equal((await call('GET', '/pots', undefined, a.token)).body.length, 0);
    assert.equal((await call('POST', `/pots/${pot.body.id}/deposit`, { amount: 100, idempotencyKey: key() }, a.token)).status, 409);
    assertHealthy();
  });
  test('goals are private', async () => {
    const a = await funded(1_000);
    const b = await funded(1_000);
    const pot = await call('POST', '/pots', { name: 'Mine', target: 1000, currency: 'USD' }, a.token);
    assert.equal((await call('POST', `/pots/${pot.body.id}/deposit`, { amount: 100, idempotencyKey: key() }, b.token)).status, 404);
    assert.equal((await call('DELETE', `/pots/${pot.body.id}`, undefined, b.token)).status, 404);
  });
});

describe('scheduled payments', () => {
  const today = () => new Date().toISOString().slice(0, 10);
  async function schedule(a: Person, recipientId: string, amount: number) {
    const r = await call('POST', '/schedules', { recipientId, currency: 'USD', amount, frequency: 'monthly', startDate: today(), pin: PIN }, a.token);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    db.prepare("UPDATE schedules SET next_run_at = '2020-01-15T08:00:00.000Z' WHERE id = ?").run(r.body.id);
    return r.body;
  }
  test('runs once per due date and moves to the next date', async () => {
    const a = await funded(10_000);
    const b = await register();
    const rec = await addP2P(a, b);
    const s = await schedule(a, rec.id, 1_000);
    tick();
    assert.equal(await balance(b), 1_000);
    const after = (await call('GET', '/schedules', undefined, a.token)).body[0];
    assert.ok(Date.parse(after.nextRunAt) > Date.now(), 'missed dates are skipped');
    db.prepare('UPDATE schedules SET next_run_at = ? WHERE id = ?').run('2020-01-15T08:00:00.000Z', s.id);
    tick();
    assert.equal(await balance(b), 1_000, 'the same due date must not pay twice');
  });
  test('needs the PIN', async () => {
    const a = await funded(1_000);
    const b = await register();
    const rec = await addP2P(a, b);
    assert.equal((await call('POST', '/schedules', { recipientId: rec.id, currency: 'USD', amount: 100, frequency: 'weekly', startDate: today(), pin: '101010' }, a.token)).status, 401);
  });
  test('retries after failure, then pauses and tells the customer', async () => {
    const a = await funded(100);
    const b = await register();
    const rec = await addP2P(a, b);
    const s = await schedule(a, rec.id, 1_000);
    for (let i = 0; i < 3; i++) {
      tick();
      db.prepare("UPDATE schedules SET retry_at = '2020-03-01T08:00:00.000Z' WHERE id = ?").run(s.id);
    }
    const after = (await call('GET', '/schedules', undefined, a.token)).body[0];
    assert.equal(after.status, 'paused');
    const notes = await call('GET', '/notifications', undefined, a.token);
    assert.ok(notes.body.items.some((n: any) => n.title === 'Scheduled payment paused'));
    assert.equal(await balance(a), 100);
  });
  test('removing a recipient pauses its schedule', async () => {
    const a = await funded(1_000);
    const b = await register();
    const rec = await addP2P(a, b);
    await schedule(a, rec.id, 100);
    await call('DELETE', `/recipients/${rec.id}`, undefined, a.token);
    assert.equal((await call('GET', '/schedules', undefined, a.token)).body[0].status, 'paused');
    tick();
    assert.equal(await balance(b), 0);
  });
});

describe('referrals, alerts, notifications, insights', () => {
  test('both people get a bonus once, after a qualifying payment', async () => {
    const inviter = await register();
    const friend = await register('USD', { referralCode: inviter.referralCode });
    await fund(friend, 500);
    assert.equal(await balance(inviter), 0, 'below the threshold');
    await fund(friend, 1_000);
    assert.equal(await balance(inviter), 200);
    assert.equal(await balance(friend), 1_700);
    await fund(friend, 1_000);
    assert.equal(await balance(inviter), 200);
    assertHealthy();
  });
  test('rejects unknown invite codes', async () => {
    const r = await call('POST', '/auth/register', { phone: fakePhone(), pin: PIN, firstName: 'A', lastName: 'B', referralCode: 'NOPE' });
    assert.equal(r.body.error.code, 'BAD_REFERRAL');
  });
  test('rate alerts fire once', async () => {
    const a = await register();
    await call('POST', '/rate-alerts', { from: 'USD', to: 'ZAR', target: 1, direction: 'above' }, a.token);
    tick();
    tick();
    const notes = await call('GET', '/notifications', undefined, a.token);
    assert.equal(notes.body.items.filter((n: any) => n.kind === 'rate_alert').length, 1);
    assert.equal((await call('GET', '/rate-alerts', undefined, a.token)).body[0].active, false);
  });
  test('notifications count and clear', async () => {
    const a = await funded(1_000);
    assert.ok((await call('GET', '/notifications', undefined, a.token)).body.unread >= 1);
    await call('POST', '/notifications/read', {}, a.token);
    assert.equal((await call('GET', '/notifications', undefined, a.token)).body.unread, 0);
  });
  test('insights total a month by category', async () => {
    const a = await funded(10_000);
    const b = await register();
    const rec = await addP2P(a, b);
    const q = await quote(a, rec.id, 1_000);
    await call('POST', '/transfers', { quoteId: q.id, pin: PIN, idempotencyKey: key(), category: 'family' }, a.token);
    const r = await call('GET', '/insights', undefined, a.token);
    assert.equal(r.body.sentUsd, 1_000);
    assert.equal(r.body.byCategory[0].category, 'family');
    assert.equal(r.body.topRecipients[0].count, 1);
    assert.equal((await call('GET', '/insights', undefined, b.token)).body.receivedUsd, 1_000);
  });
});

describe('verification', () => {
  const form = { legalName: 'Test User', dateOfBirth: '1990-02-02', documentType: 'passport', documentNumber: 'A123456', address: '1 Long Street' };
  test('approval raises limits, rejection allows another try', async () => {
    const a = await register();
    assert.equal((await call('POST', '/kyc', form, a.token)).status, 201);
    assert.equal((await call('POST', '/kyc', form, a.token)).status, 409);
    const first = db.prepare('SELECT id FROM kyc_submissions WHERE user_id = ?').pluck().get(a.id);
    assert.equal((await call('POST', `/admin/kyc/${first}`, { decision: 'rejected' }, agentToken)).status, 422);
    await call('POST', `/admin/kyc/${first}`, { decision: 'rejected', reason: 'Photo unclear' }, agentToken);
    assert.equal((await call('POST', `/admin/kyc/${first}`, { decision: 'approved' }, agentToken)).status, 409);
    assert.equal((await call('GET', '/kyc', undefined, a.token)).body.latest.reason, 'Photo unclear');
    assert.equal((await call('POST', '/kyc', form, a.token)).status, 201);
    const second = db.prepare("SELECT id FROM kyc_submissions WHERE user_id = ? AND status = 'pending'").pluck().get(a.id);
    await call('POST', `/admin/kyc/${second}`, { decision: 'approved' }, agentToken);
    assert.equal((await call('GET', '/me/limits', undefined, a.token)).body.tier, 2);
  });
  test('refuses under-18s', async () => {
    const a = await register();
    assert.equal((await call('POST', '/kyc', { ...form, dateOfBirth: '2020-01-01' }, a.token)).status, 422);
  });
});

describe('console', () => {
  test('wrong staff passwords fail', async () => {
    assert.equal((await call('POST', '/admin/auth/login', { email: 'owner@fakeemail.com', password: 'nope' })).status, 401);
    assert.equal((await call('POST', '/admin/auth/login', { email: 'nobody@fakeemail.com', password: 'nope' })).status, 401);
  });
  test('overview reports totals and a 30-day series', async () => {
    const r = await call('GET', '/admin/overview', undefined, agentToken);
    assert.equal(r.status, 200);
    assert.equal(r.body.series.length, 30);
    assert.ok(r.body.customers > 0);
    assert.equal(r.body.ledgerHealthy, true);
  });
  test('transactions filter, page, and show ledger entries', async () => {
    const a = await funded(5_000);
    const list = await call('GET', `/admin/transactions?userId=${a.id}&type=topup`, undefined, agentToken);
    assert.equal(list.body.total, 1);
    const detail = await call('GET', `/admin/transactions/${list.body.items[0].id}`, undefined, agentToken);
    assert.equal(detail.body.entries.reduce((s: number, e: any) => s + e.amount, 0), 0);
  });
  test('CSV export neutralises spreadsheet formulas', async () => {
    const r = await call('POST', '/auth/register', { phone: fakePhone(), pin: PIN, firstName: '=HYPERLINK("x")', lastName: 'Evil' });
    await fund({ token: r.body.token } as Person, 100);
    const csv = await call('GET', '/admin/transactions?format=csv&q=Evil', undefined, agentToken);
    assert.equal(typeof csv.body, 'string');
    assert.ok(csv.body.includes(`"'=HYPERLINK`));
  });
  test('owner-only actions are enforced', async () => {
    const a = await register();
    assert.equal((await call('PATCH', '/admin/pricing/spread', { spreadBps: 10 }, agentToken)).status, 403);
    assert.equal((await call('PATCH', '/admin/pricing/rates/EUR', { perUsd: 1 }, agentToken)).status, 403);
    assert.equal((await call('POST', `/admin/users/${a.id}/adjust`, { currency: 'USD', amount: 100, reason: 'Gift' }, agentToken)).status, 403);
    assert.equal((await call('PATCH', `/admin/users/${a.id}`, { tier: 3, reason: 'Trusted' }, agentToken)).status, 403);
    assert.equal((await call('GET', '/admin/team', undefined, agentToken)).status, 403);
  });
  test('USD stays the base rate, and rate changes affect new quotes', async () => {
    assert.equal((await call('PATCH', '/admin/pricing/rates/USD', { perUsd: 2 }, ownerToken)).status, 422);
    const a = await funded(10_000);
    const rec = await addPayout(a, '100000999111', 'mobile_money', 'GHS');
    const before = await quote(a, rec.id, 1_000);
    await call('PATCH', '/admin/pricing/rates/GHS', { perUsd: 30.4 }, ownerToken);
    const after = await quote(a, rec.id, 1_000);
    assert.ok(Math.abs(after.rate / before.rate - 2) < 0.0001);
    await call('PATCH', '/admin/pricing/rates/GHS', { perUsd: 15.2 }, ownerToken);
  });
  test('a quote keeps its price after the rate changes', async () => {
    const a = await funded(10_000);
    const b = await register();
    const rec = await addP2P(a, b, 'GHS');
    const q = await quote(a, rec.id, 1_000);
    await call('PATCH', '/admin/pricing/rates/GHS', { perUsd: 30.4 }, ownerToken);
    const r = await call('POST', '/transfers', { quoteId: q.id, pin: PIN, idempotencyKey: key() }, a.token);
    await call('PATCH', '/admin/pricing/rates/GHS', { perUsd: 15.2 }, ownerToken);
    assert.equal(r.body.receiveAmount, q.receiveAmount);
  });
  test('adjustments stay balanced and cannot overdraw', async () => {
    const a = await funded(1_000);
    assert.equal((await call('POST', `/admin/users/${a.id}/adjust`, { currency: 'USD', amount: 500, reason: 'Goodwill credit' }, ownerToken)).status, 201);
    assert.equal(await balance(a), 1_500);
    assert.equal((await call('POST', `/admin/users/${a.id}/adjust`, { currency: 'USD', amount: -99_999, reason: 'Too much' }, ownerToken)).body.error.code, 'INSUFFICIENT_FUNDS');
    assertHealthy();
  });
  test('sensitive actions are written to the audit log', async () => {
    const a = await funded(1_000);
    await call('POST', `/admin/users/${a.id}/adjust`, { currency: 'USD', amount: 1, reason: 'Audit me' }, ownerToken);
    const log = await call('GET', '/admin/audit', undefined, agentToken);
    assert.equal(log.body.items[0].action, 'customer.adjust');
    assert.equal(log.body.items[0].staffName, 'YOUR_OWNER_NAME');
  });
  test('team: passwords need length, deactivation ends access, no self-lockout', async () => {
    assert.equal((await call('POST', '/admin/team', { email: 'x@fakeemail.com', name: 'New', password: 'short', role: 'agent' }, ownerToken)).status, 422);
    const added = await call('POST', '/admin/team', { email: 'temp@fakeemail.com', name: 'Temp Staff', password: 'YOUR_LONG_PASSWORD', role: 'agent' }, ownerToken);
    assert.equal(added.status, 201);
    const login = await call('POST', '/admin/auth/login', { email: 'temp@fakeemail.com', password: 'YOUR_LONG_PASSWORD' });
    await call('PATCH', `/admin/team/${added.body.id}`, { active: false }, ownerToken);
    assert.equal((await call('GET', '/admin/me', undefined, login.body.token)).status, 401);
    const me = await call('GET', '/admin/me', undefined, ownerToken);
    assert.equal((await call('PATCH', `/admin/team/${me.body.id}`, { active: false }, ownerToken)).status, 422);
  });
  test('the ledger endpoint reports healthy after everything above', async () => {
    const r = await call('GET', '/admin/ledger/health', undefined, agentToken);
    assert.equal(r.body.healthy, true);
    assert.deepEqual(r.body.mismatchedAccounts, []);
  });
});

test('health check and unknown routes', async () => {
  assert.equal((await fetch(`${base}/health`)).status, 200);
  assert.equal((await call('GET', '/nope')).status, 404);
});
