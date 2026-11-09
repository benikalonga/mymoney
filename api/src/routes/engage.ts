import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config';
import { db, tx } from '../db';
import { createPotAccount, ensureWallet, getAccount, post } from '../domain/ledger';
import { requireUser, verifyPin } from '../lib/auth';
import { ApiError, h, invalid, notFound, parse } from '../lib/http';
import { newId, now } from '../lib/ids';
import { formatMoney, fullName, getUser, notify, perUsd, priceFor, requireActive, type UserRow } from '../services/core';
import { presentTx } from '../services/present';
import { createTx, executeTransfer, findByIdempotency } from '../services/transfers';

export const engageRouter = Router();
engageRouter.use(['/recipients', '/requests', '/pots', '/schedules', '/rate-alerts', '/notifications', '/insights', '/kyc'], requireUser);

const amount = z.number().int().positive().max(100_000_000_00);
const currency = z.string().length(3).toUpperCase();
const key = z.string().min(8).max(100);
const handle = z.string().trim().min(3).max(30).transform((s) => s.replace(/^@/, '').replace(/[\s()-]/g, '').toLowerCase());

function findCustomer(q: string) {
  return db.prepare("SELECT * FROM users WHERE (phone = ? OR tag = ?) AND status = 'active'").get(q, q) as UserRow | undefined;
}

// --- Recipients ---
interface RecipientRow { id: string; name: string; method: string; provider: string | null; account: string; currency: string; counterparty_id: string | null; favorite: number; last_used_at: string | null; created_at: string }
const presentRecipient = (r: RecipientRow) => ({ id: r.id, name: r.name, method: r.method, provider: r.provider, account: r.account, currency: r.currency, favorite: !!r.favorite, lastUsedAt: r.last_used_at });

const recipientBody = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  method: z.enum(['mymoney', 'mobile_money', 'bank']),
  provider: z.string().trim().max(40).optional(),
  account: z.string().trim().min(3).max(34),
  currency,
});

engageRouter.get('/recipients', h((req) => {
  const rows = db.prepare('SELECT * FROM recipients WHERE user_id = ? AND deleted_at IS NULL ORDER BY favorite DESC, last_used_at DESC, name').all(req.user.id) as RecipientRow[];
  return rows.map(presentRecipient);
}));

engageRouter.post('/recipients', h((req, res) => {
  const body = parse(recipientBody, req.body);
  perUsd(body.currency);
  let counterpartyId: string | null = null;
  let name = body.name;
  let account = body.account.replace(/[\s()-]/g, '');
  if (body.method === 'mymoney') {
    const customer = findCustomer(account.replace(/^@/, '').toLowerCase());
    if (!customer) throw invalid('No MyMoney user has that phone number or tag', 'USER_NOT_FOUND');
    if (customer.id === req.user.id) throw invalid('You cannot add yourself as a recipient');
    counterpartyId = customer.id;
    name = fullName(customer);
    account = customer.tag;
  } else {
    if (!name) throw invalid('name: Required');
    if (!body.provider) throw invalid('provider: Required');
    if (!/^\+?[0-9]{6,20}$/.test(account)) throw invalid('Enter a valid account or phone number');
  }
  const dupe = db.prepare('SELECT * FROM recipients WHERE user_id = ? AND method = ? AND account = ? AND currency = ? AND deleted_at IS NULL').get(req.user.id, body.method, account, body.currency) as RecipientRow | undefined;
  if (dupe) return presentRecipient(dupe);
  const id = newId();
  db.prepare('INSERT INTO recipients (id, user_id, name, method, provider, account, currency, counterparty_id, created_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(id, req.user.id, name, body.method, body.provider ?? null, account, body.currency, counterpartyId, now());
  res.status(201);
  return presentRecipient(db.prepare('SELECT * FROM recipients WHERE id = ?').get(id) as RecipientRow);
}));

engageRouter.patch('/recipients/:id', h((req) => {
  const body = parse(z.object({ name: z.string().trim().min(2).max(80).optional(), favorite: z.boolean().optional() }), req.body);
  const info = db.prepare('UPDATE recipients SET name = COALESCE(?, name), favorite = COALESCE(?, favorite) WHERE id = ? AND user_id = ? AND deleted_at IS NULL')
    .run(body.name ?? null, body.favorite === undefined ? null : Number(body.favorite), req.params.id, req.user.id);
  if (!info.changes) throw notFound('Recipient');
  return presentRecipient(db.prepare('SELECT * FROM recipients WHERE id = ?').get(req.params.id) as RecipientRow);
}));

engageRouter.delete('/recipients/:id', h((req) => {
  const info = db.prepare('UPDATE recipients SET deleted_at = ? WHERE id = ? AND user_id = ? AND deleted_at IS NULL').run(now(), req.params.id, req.user.id);
  if (!info.changes) throw notFound('Recipient');
  db.prepare("UPDATE schedules SET status = 'paused', last_result = 'Recipient removed' WHERE recipient_id = ? AND user_id = ?").run(req.params.id, req.user.id);
  return { ok: true };
}));

// --- Money requests ---
interface RequestRow { id: string; requester_id: string; payer_id: string; currency: string; amount: number; note: string | null; status: string; transaction_id: string | null; expires_at: string; created_at: string }
function presentRequest(r: RequestRow, viewer: string) {
  const other = getUser(r.requester_id === viewer ? r.payer_id : r.requester_id)!;
  return { id: r.id, box: r.requester_id === viewer ? 'outgoing' : 'incoming', otherName: fullName(other), currency: r.currency, amount: r.amount, note: r.note, status: r.status, transactionId: r.transaction_id, expiresAt: r.expires_at, createdAt: r.created_at };
}
const getRequest = (id: string) => db.prepare('SELECT * FROM money_requests WHERE id = ?').get(id) as RequestRow | undefined;

engageRouter.get('/requests', h((req) => {
  const box = parse(z.object({ box: z.enum(['incoming', 'outgoing']).default('incoming') }), req.query).box;
  const column = box === 'incoming' ? 'payer_id' : 'requester_id';
  const rows = db.prepare(`SELECT * FROM money_requests WHERE ${column} = ? ORDER BY created_at DESC LIMIT 100`).all(req.user.id) as RequestRow[];
  return rows.map((r) => presentRequest(r, req.user.id));
}));

engageRouter.post('/requests', h((req, res) => {
  const body = parse(z.object({ payer: handle, currency, amount, note: z.string().trim().max(140).optional() }), req.body);
  perUsd(body.currency);
  requireActive(req.user.id);
  const payer = findCustomer(body.payer);
  if (!payer) throw invalid('No MyMoney user has that phone number or tag', 'USER_NOT_FOUND');
  if (payer.id === req.user.id) throw invalid('You cannot request money from yourself');
  const id = newId();
  const expires = new Date(Date.now() + config.requestTtlDays * 86_400_000).toISOString();
  tx(() => {
    db.prepare("INSERT INTO money_requests (id, requester_id, payer_id, currency, amount, note, status, expires_at, created_at) VALUES (?,?,?,?,?,?,'pending',?,?)")
      .run(id, req.user.id, payer.id, body.currency, body.amount, body.note ?? null, expires, now());
    notify(payer.id, 'request_received', 'Payment request', `${fullName(req.user)} asked you for ${formatMoney(body.amount, body.currency)}.`);
  });
  res.status(201);
  return presentRequest(getRequest(id)!, req.user.id);
}));

engageRouter.post('/requests/:id/pay', h(async (req, res) => {
  const body = parse(z.object({ pin: z.string().max(12), idempotencyKey: key, fromCurrency: currency.optional() }), req.body);
  await verifyPin(req.user, body.pin);
  const result = tx(() => {
    const existing = findByIdempotency(req.user.id, body.idempotencyKey);
    if (existing) return { transaction: existing, replayed: true };
    const request = getRequest(req.params.id);
    if (!request || request.payer_id !== req.user.id) throw notFound('Request');
    if (request.status !== 'pending') throw new ApiError(409, 'INVALID_STATE', `This request is already ${request.status}`);
    if (request.expires_at <= now()) throw new ApiError(409, 'INVALID_STATE', 'This request has expired');
    const from = body.fromCurrency ?? request.currency;
    const p = priceFor('mymoney', from, request.currency, { receiveAmount: request.amount });
    const requester = getUser(request.requester_id)!;
    const outcome = executeTransfer({
      userId: req.user.id, method: 'mymoney', sendCurrency: from, sendAmount: p.sendAmount, fee: p.fee, rate: p.rate, receiveCurrency: request.currency, receiveAmount: p.receiveAmount,
      counterpartyId: requester.id, counterpartyName: fullName(requester), note: request.note, idempotencyKey: body.idempotencyKey, requestId: request.id,
    });
    db.prepare("UPDATE money_requests SET status = 'paid', transaction_id = ? WHERE id = ?").run(outcome.transaction.id, request.id);
    return outcome;
  });
  res.status(result.replayed ? 200 : 201);
  return presentTx(result.transaction, req.user.id);
}));

engageRouter.post('/requests/:id/:action(decline|cancel)', h((req) => {
  const decline = req.params.action === 'decline';
  return tx(() => {
    const request = getRequest(req.params.id);
    if (!request || (decline ? request.payer_id : request.requester_id) !== req.user.id) throw notFound('Request');
    if (request.status !== 'pending') throw new ApiError(409, 'INVALID_STATE', `This request is already ${request.status}`);
    db.prepare('UPDATE money_requests SET status = ? WHERE id = ?').run(decline ? 'declined' : 'cancelled', request.id);
    if (decline) notify(request.requester_id, 'request_declined', 'Request declined', `${fullName(req.user)} declined your request for ${formatMoney(request.amount, request.currency)}.`);
    return presentRequest(getRequest(request.id)!, req.user.id);
  });
}));

// --- Savings goals ---
interface PotRow { id: string; user_id: string; account_id: string; name: string; target: number; target_date: string | null; closed_at: string | null; created_at: string; balance: number; currency: string }
const potSelect = 'SELECT p.*, a.balance, a.currency FROM pots p JOIN accounts a ON a.id = p.account_id';
const presentPot = (p: PotRow) => ({ id: p.id, name: p.name, currency: p.currency, balance: p.balance, target: p.target, targetDate: p.target_date, progress: Math.min(1, p.balance / p.target), closed: !!p.closed_at, createdAt: p.created_at });
function ownedPot(id: string, userId: string) {
  const pot = db.prepare(`${potSelect} WHERE p.id = ? AND p.user_id = ?`).get(id, userId) as PotRow | undefined;
  if (!pot) throw notFound('Goal');
  if (pot.closed_at) throw new ApiError(409, 'INVALID_STATE', 'This goal is closed');
  return pot;
}

function movePot(pot: PotRow, userId: string, value: number, deposit: boolean, key?: string) {
  const wallet = ensureWallet(userId, pot.currency);
  const t = createTx({
    type: deposit ? 'pot_deposit' : 'pot_withdrawal', status: 'completed', user_id: userId, counterparty_name: pot.name, send_currency: pot.currency, send_amount: value,
    receive_currency: pot.currency, receive_amount: value, usd_value: 0, pot_id: pot.id, idempotency_key: key ?? null, completed_at: now(),
  });
  const potAccount = getAccount(pot.account_id);
  post(t.id, deposit
    ? [{ account: wallet, amount: -value }, { account: potAccount, amount: value }]
    : [{ account: potAccount, amount: -value }, { account: wallet, amount: value }]);
}

engageRouter.get('/pots', h((req) => (db.prepare(`${potSelect} WHERE p.user_id = ? AND p.closed_at IS NULL ORDER BY p.created_at DESC`).all(req.user.id) as PotRow[]).map(presentPot)));

engageRouter.post('/pots', h((req, res) => {
  const body = parse(z.object({ name: z.string().trim().min(1).max(40), target: amount, currency, targetDate: z.string().date().optional() }), req.body);
  perUsd(body.currency);
  const id = newId();
  tx(() => {
    const account = createPotAccount(req.user.id, body.currency);
    db.prepare('INSERT INTO pots (id, user_id, account_id, name, target, target_date, created_at) VALUES (?,?,?,?,?,?,?)').run(id, req.user.id, account.id, body.name, body.target, body.targetDate ?? null, now());
  });
  res.status(201);
  return presentPot(db.prepare(`${potSelect} WHERE p.id = ?`).get(id) as PotRow);
}));

engageRouter.post('/pots/:id/:action(deposit|withdraw)', h((req) => {
  const body = parse(z.object({ amount, idempotencyKey: key }), req.body);
  return tx(() => {
    requireActive(req.user.id);
    const pot = ownedPot(req.params.id, req.user.id);
    if (!findByIdempotency(req.user.id, body.idempotencyKey)) movePot(pot, req.user.id, body.amount, req.params.action === 'deposit', body.idempotencyKey);
    return presentPot(db.prepare(`${potSelect} WHERE p.id = ?`).get(pot.id) as PotRow);
  });
}));

engageRouter.delete('/pots/:id', h((req) => tx(() => {
  requireActive(req.user.id);
  const pot = ownedPot(req.params.id, req.user.id);
  if (pot.balance > 0) movePot(pot, req.user.id, pot.balance, false);
  db.prepare('UPDATE pots SET closed_at = ? WHERE id = ?').run(now(), pot.id);
  return { ok: true, returned: pot.balance, currency: pot.currency };
})));

// --- Scheduled payments ---
interface ScheduleRow { id: string; recipient_id: string; send_currency: string; amount: number; frequency: string; note: string | null; next_run_at: string; status: string; failures: number; last_result: string | null; recipient_name: string }
const scheduleSelect = 'SELECT s.*, r.name AS recipient_name FROM schedules s JOIN recipients r ON r.id = s.recipient_id';
const presentSchedule = (s: ScheduleRow) => ({ id: s.id, recipientId: s.recipient_id, recipientName: s.recipient_name, currency: s.send_currency, amount: s.amount, frequency: s.frequency, note: s.note, nextRunAt: s.next_run_at, status: s.status, lastResult: s.last_result });

engageRouter.get('/schedules', h((req) => (db.prepare(`${scheduleSelect} WHERE s.user_id = ? ORDER BY s.next_run_at`).all(req.user.id) as ScheduleRow[]).map(presentSchedule)));

engageRouter.post('/schedules', h(async (req, res) => {
  const body = parse(z.object({ recipientId: z.string(), currency, amount, frequency: z.enum(['weekly', 'monthly']), startDate: z.string().date(), note: z.string().trim().max(140).optional(), pin: z.string().max(12) }), req.body);
  await verifyPin(req.user, body.pin);
  perUsd(body.currency);
  const recipient = db.prepare('SELECT id FROM recipients WHERE id = ? AND user_id = ? AND deleted_at IS NULL').get(body.recipientId, req.user.id);
  if (!recipient) throw notFound('Recipient');
  const start = new Date(`${body.startDate}T08:00:00.000Z`);
  if (start.getTime() < Date.now() - 86_400_000) throw invalid('The start date is in the past');
  const id = newId();
  db.prepare("INSERT INTO schedules (id, user_id, recipient_id, send_currency, amount, frequency, anchor_day, note, next_run_at, status, created_at) VALUES (?,?,?,?,?,?,?,?,?,'active',?)")
    .run(id, req.user.id, body.recipientId, body.currency, body.amount, body.frequency, start.getUTCDate(), body.note ?? null, start.toISOString(), now());
  res.status(201);
  return presentSchedule(db.prepare(`${scheduleSelect} WHERE s.id = ?`).get(id) as ScheduleRow);
}));

engageRouter.patch('/schedules/:id', h((req) => {
  const body = parse(z.object({ status: z.enum(['active', 'paused']) }), req.body);
  const info = db.prepare('UPDATE schedules SET status = ?, failures = 0, retry_at = NULL WHERE id = ? AND user_id = ?').run(body.status, req.params.id, req.user.id);
  if (!info.changes) throw notFound('Schedule');
  return presentSchedule(db.prepare(`${scheduleSelect} WHERE s.id = ?`).get(req.params.id) as ScheduleRow);
}));

engageRouter.delete('/schedules/:id', h((req) => {
  if (!db.prepare('DELETE FROM schedules WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id).changes) throw notFound('Schedule');
  return { ok: true };
}));

// --- Rate alerts ---
engageRouter.get('/rate-alerts', h((req) => {
  const rows = db.prepare('SELECT id, from_currency AS "from", to_currency AS "to", target, direction, active, triggered_at AS triggeredAt FROM rate_alerts WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id) as { active: number }[];
  return rows.map((r) => ({ ...r, active: !!r.active }));
}));

engageRouter.post('/rate-alerts', h((req, res) => {
  const body = parse(z.object({ from: currency, to: currency, target: z.number().positive(), direction: z.enum(['above', 'below']) }), req.body);
  perUsd(body.from);
  perUsd(body.to);
  const id = newId();
  db.prepare('INSERT INTO rate_alerts (id, user_id, from_currency, to_currency, target, direction, created_at) VALUES (?,?,?,?,?,?,?)').run(id, req.user.id, body.from, body.to, body.target, body.direction, now());
  res.status(201);
  return { id, ...body, active: true, triggeredAt: null };
}));

engageRouter.delete('/rate-alerts/:id', h((req) => {
  if (!db.prepare('DELETE FROM rate_alerts WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id).changes) throw notFound('Alert');
  return { ok: true };
}));

// --- Notifications ---
engageRouter.get('/notifications', h((req) => {
  const items = db.prepare('SELECT id, kind, title, body, transaction_id AS transactionId, read_at AS readAt, created_at AS createdAt FROM notifications WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 100').all(req.user.id);
  const unread = (db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL').get(req.user.id) as { n: number }).n;
  return { items, unread };
}));

engageRouter.post('/notifications/read', h((req) => {
  db.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL').run(now(), req.user.id);
  return { ok: true };
}));

// --- Spending insights ---
engageRouter.get('/insights', h((req) => {
  const month = parse(z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).default(new Date().toISOString().slice(0, 7)) }), req.query).month;
  const me = req.user.id;
  const like = `${month}%`;
  const one = (sql: string) => (db.prepare(sql).get(me, like) as { total: number }).total;
  const sentUsd = one("SELECT COALESCE(SUM(usd_value),0) AS total FROM transactions WHERE user_id = ? AND type='transfer' AND status='completed' AND created_at LIKE ?");
  const receivedUsd = one("SELECT COALESCE(SUM(usd_value),0) AS total FROM transactions WHERE counterparty_id = ? AND type='transfer' AND status='completed' AND created_at LIKE ?");
  const addedUsd = one("SELECT COALESCE(SUM(usd_value),0) AS total FROM transactions WHERE user_id = ? AND type='topup' AND status='completed' AND created_at LIKE ?");
  const byCategory = db.prepare(`SELECT COALESCE(category,'other') AS category, SUM(usd_value) AS usd, COUNT(*) AS count FROM transactions
    WHERE user_id = ? AND type='transfer' AND status='completed' AND created_at LIKE ? GROUP BY COALESCE(category,'other') ORDER BY usd DESC`).all(me, like);
  const topRecipients = db.prepare(`SELECT counterparty_name AS name, SUM(usd_value) AS usd, COUNT(*) AS count FROM transactions
    WHERE user_id = ? AND type='transfer' AND status='completed' AND created_at LIKE ? GROUP BY counterparty_name ORDER BY usd DESC LIMIT 5`).all(me, like);
  const sinceDate = new Date();
  sinceDate.setUTCDate(1);
  sinceDate.setUTCMonth(sinceDate.getUTCMonth() - 5);
  const trend = db.prepare(`SELECT substr(created_at,1,7) AS month, SUM(usd_value) AS usd FROM transactions
    WHERE user_id = ? AND type='transfer' AND status='completed' AND created_at >= ? GROUP BY month ORDER BY month`).all(me, sinceDate.toISOString().slice(0, 7));
  return { month, sentUsd, receivedUsd, addedUsd, byCategory, topRecipients, trend };
}));

// --- Identity verification ---
engageRouter.get('/kyc', h((req) => {
  const latest = db.prepare('SELECT status, decision_reason AS reason, created_at AS createdAt FROM kyc_submissions WHERE user_id = ? ORDER BY created_at DESC LIMIT 1').get(req.user.id);
  return { status: req.user.kyc_status, tier: req.user.tier, latest: latest ?? null };
}));

engageRouter.post('/kyc', h((req, res) => {
  const body = parse(z.object({
    legalName: z.string().trim().min(3).max(120), dateOfBirth: z.string().date(), documentType: z.enum(['national_id', 'passport', 'drivers_licence']),
    documentNumber: z.string().trim().min(4).max(40), address: z.string().trim().min(5).max(200),
  }), req.body);
  const age = (Date.now() - Date.parse(body.dateOfBirth)) / (365.25 * 86_400_000);
  if (age < 18) throw invalid('You must be at least 18 to verify an account');
  return tx(() => {
    if (['pending', 'approved'].includes(req.user.kyc_status)) throw new ApiError(409, 'INVALID_STATE', 'Your verification is already in progress or approved');
    db.prepare("INSERT INTO kyc_submissions (id, user_id, legal_name, date_of_birth, document_type, document_number, address, status, created_at) VALUES (?,?,?,?,?,?,?,'pending',?)")
      .run(newId(), req.user.id, body.legalName, body.dateOfBirth, body.documentType, body.documentNumber, body.address, now());
    db.prepare("UPDATE users SET kyc_status = 'pending' WHERE id = ?").run(req.user.id);
    res.status(201);
    return { status: 'pending' };
  });
}));
