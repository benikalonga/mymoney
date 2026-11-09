import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config';
import { db, tx } from '../db';
import { customerRate } from '../domain/pricing';
import { ensureWallet, findWallet } from '../domain/ledger';
import { requireUser, verifyPin } from '../lib/auth';
import { ApiError, h, invalid, notFound, parse } from '../lib/http';
import { newId, now } from '../lib/ids';
import { getTx, getUser, fullName, perUsd, priceFor, spreadBps, type TxRow } from '../services/core';
import { presentTx } from '../services/present';
import { createTopup, exchange, executeTransfer, findByIdempotency } from '../services/transfers';

export const CATEGORIES = ['family', 'bills', 'school', 'business', 'savings', 'gift', 'other'];
export const PROVIDERS = {
  mobile_money: ['M-Pesa', 'MTN MoMo', 'Airtel Money', 'Orange Money'],
  bank: ['Standard Bank', 'FNB', 'Absa', 'Equity Bank', 'Ecobank', 'GTBank'],
  topup: ['M-Pesa', 'MTN MoMo', 'Airtel Money', 'Visa / Mastercard', 'Bank transfer'],
};

const amount = z.number().int().positive().max(100_000_000_00);
const currency = z.string().length(3).toUpperCase();
const key = z.string().min(8).max(100);
const pin = z.string().max(12);

export const moneyRouter = Router();

interface QuoteRow { id: string; user_id: string; recipient_id: string | null; method: string; send_currency: string; send_amount: number; fee: number; rate: number; receive_currency: string; receive_amount: number; expires_at: string; used_at: string | null }
interface RecipientRow { id: string; user_id: string; name: string; method: 'mymoney' | 'mobile_money' | 'bank'; provider: string | null; account: string; currency: string; counterparty_id: string | null; deleted_at: string | null }

function saveQuote(userId: string, recipientId: string | null, method: string, sendCurrency: string, receiveCurrency: string, p: ReturnType<typeof priceFor>) {
  const id = newId();
  const expiresAt = new Date(Date.now() + config.quoteTtlSeconds * 1000).toISOString();
  db.prepare(`INSERT INTO quotes (id, user_id, recipient_id, method, send_currency, send_amount, fee, rate, receive_currency, receive_amount, expires_at, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, userId, recipientId, method, sendCurrency, p.sendAmount, p.fee, p.rate, receiveCurrency, p.receiveAmount, expiresAt, now());
  return { id, method, sendCurrency, receiveCurrency, sendAmount: p.sendAmount, receiveAmount: p.receiveAmount, fee: p.fee, total: p.total, rate: p.rate, expiresAt };
}

/** Marks a quote as spent. A quote can pay for exactly one transaction. */
function consumeQuote(id: string, userId: string, method?: string): QuoteRow {
  const quote = db.prepare('SELECT * FROM quotes WHERE id = ? AND user_id = ?').get(id, userId) as QuoteRow | undefined;
  if (!quote || (method && quote.method !== method)) throw notFound('Quote');
  if (quote.used_at) throw new ApiError(409, 'QUOTE_USED', 'This quote was already used. Please get a new one.');
  if (quote.expires_at <= now()) throw new ApiError(409, 'QUOTE_EXPIRED', 'This rate has expired. Please get a new one.');
  db.prepare('UPDATE quotes SET used_at = ? WHERE id = ?').run(now(), id);
  return quote;
}

moneyRouter.get('/meta', h(() => ({
  currencies: db.prepare('SELECT currency AS code, name FROM rates ORDER BY currency').all(),
  categories: CATEGORIES, providers: PROVIDERS,
  fees: (db.prepare('SELECT method, percent_bps AS percentBps, flat_usd AS flatUsd FROM fee_rules').all()),
})));

moneyRouter.get('/rates', h((req) => {
  const base = parse(z.object({ base: currency.default('USD') }), req.query).base;
  const basePerUsd = perUsd(base);
  const spread = spreadBps();
  const rows = db.prepare('SELECT currency, name, per_usd, updated_at FROM rates ORDER BY currency').all() as { currency: string; name: string; per_usd: number; updated_at: string }[];
  return { base, rates: rows.filter((r) => r.currency !== base).map((r) => ({ currency: r.currency, name: r.name, rate: customerRate(basePerUsd, r.per_usd, spread, false), updatedAt: r.updated_at })) };
}));

moneyRouter.use(['/wallets', '/quotes', '/transfers', '/exchange', '/topups', '/transactions', '/users'], requireUser);

moneyRouter.get('/wallets', h((req) => {
  const wallets = db.prepare("SELECT id, currency, balance FROM accounts WHERE kind = 'wallet' AND user_id = ? ORDER BY currency").all(req.user.id) as { id: string; currency: string; balance: number }[];
  const totalUsd = wallets.reduce((sum, w) => sum + w.balance / perUsd(w.currency), 0);
  const held = db.prepare("SELECT send_currency AS currency, SUM(send_amount + fee) AS amount FROM transactions WHERE user_id = ? AND type = 'transfer' AND status IN ('review','pending') GROUP BY send_currency").all(req.user.id) as { currency: string; amount: number }[];
  return { wallets, held, totalUsd: Math.round(totalUsd), totalInDefault: Math.round(totalUsd * perUsd(req.user.default_currency)), defaultCurrency: req.user.default_currency };
}));

moneyRouter.post('/wallets', h((req, res) => {
  const body = parse(z.object({ currency }), req.body);
  perUsd(body.currency);
  const wallet = ensureWallet(req.user.id, body.currency);
  res.status(201);
  return { id: wallet.id, currency: wallet.currency, balance: wallet.balance };
}));

moneyRouter.get('/users/lookup', h((req) => {
  const q = parse(z.object({ q: z.string().trim().min(3).max(30) }), req.query).q.replace(/^@/, '').replace(/[\s()-]/g, '').toLowerCase();
  const user = db.prepare("SELECT first_name, last_name, tag, id FROM users WHERE (phone = ? OR tag = ?) AND status = 'active'").get(q, q) as { first_name: string; last_name: string; tag: string; id: string } | undefined;
  if (!user || user.id === req.user.id) throw notFound('MyMoney user');
  return { name: `${user.first_name} ${user.last_name[0]}.`, tag: user.tag };
}));

moneyRouter.post('/quotes', h((req, res) => {
  const body = parse(z.object({
    recipientId: z.string().optional(), receiveCurrency: currency.optional(), method: z.enum(['mymoney', 'mobile_money', 'bank', 'exchange']).optional(),
    sendCurrency: currency, sendAmount: amount.optional(), receiveAmount: amount.optional(),
  }).refine((b) => (b.sendAmount === undefined) !== (b.receiveAmount === undefined), 'Provide either sendAmount or receiveAmount'), req.body);
  let method = body.method;
  let receiveCurrency = body.receiveCurrency;
  if (body.recipientId) {
    const recipient = db.prepare('SELECT * FROM recipients WHERE id = ? AND user_id = ? AND deleted_at IS NULL').get(body.recipientId, req.user.id) as RecipientRow | undefined;
    if (!recipient) throw notFound('Recipient');
    method = recipient.method;
    receiveCurrency = recipient.currency;
  }
  if (!method || !receiveCurrency) throw invalid('recipientId, or both method and receiveCurrency, are required');
  if (method === 'exchange' && receiveCurrency === body.sendCurrency) throw invalid('Choose two different currencies');
  const p = priceFor(method, body.sendCurrency, receiveCurrency, { sendAmount: body.sendAmount, receiveAmount: body.receiveAmount });
  res.status(201);
  return saveQuote(req.user.id, body.recipientId ?? null, method, body.sendCurrency, receiveCurrency, p);
}));

moneyRouter.post('/transfers', h(async (req, res) => {
  const body = parse(z.object({ quoteId: z.string(), pin, idempotencyKey: key, note: z.string().trim().max(140).optional(), category: z.enum(CATEGORIES as [string, ...string[]]).optional() }), req.body);
  await verifyPin(req.user, body.pin);
  const result = tx(() => {
    const existing = findByIdempotency(req.user.id, body.idempotencyKey);
    if (existing) return { transaction: existing, replayed: true };
    const quote = consumeQuote(body.quoteId, req.user.id);
    if (!quote.recipient_id) throw invalid('This quote has no recipient');
    const recipient = db.prepare('SELECT * FROM recipients WHERE id = ? AND deleted_at IS NULL').get(quote.recipient_id) as RecipientRow | undefined;
    if (!recipient) throw notFound('Recipient');
    return executeTransfer({
      userId: req.user.id, method: recipient.method, sendCurrency: quote.send_currency, sendAmount: quote.send_amount, fee: quote.fee, rate: quote.rate,
      receiveCurrency: quote.receive_currency, receiveAmount: quote.receive_amount, counterpartyId: recipient.counterparty_id, counterpartyName: recipient.name,
      recipientId: recipient.id, provider: recipient.provider, payoutAccount: recipient.method === 'mymoney' ? null : recipient.account, note: body.note, category: body.category, idempotencyKey: body.idempotencyKey,
    });
  });
  res.status(result.replayed ? 200 : 201);
  return presentTx(result.transaction, req.user.id);
}));

moneyRouter.post('/exchange', h(async (req, res) => {
  const body = parse(z.object({ quoteId: z.string(), pin, idempotencyKey: key }), req.body);
  await verifyPin(req.user, body.pin);
  const t = tx(() => {
    const existing = findByIdempotency(req.user.id, body.idempotencyKey);
    if (existing) return existing;
    const q = consumeQuote(body.quoteId, req.user.id, 'exchange');
    if (!findWallet(req.user.id, q.send_currency)) throw new ApiError(422, 'INSUFFICIENT_FUNDS', `You have no ${q.send_currency} wallet`);
    return exchange({ userId: req.user.id, sendCurrency: q.send_currency, sendAmount: q.send_amount, fee: q.fee, rate: q.rate, receiveCurrency: q.receive_currency, receiveAmount: q.receive_amount, idempotencyKey: body.idempotencyKey });
  });
  res.status(201);
  return presentTx(t, req.user.id);
}));

moneyRouter.post('/topups', h((req, res) => {
  const body = parse(z.object({ currency, amount, provider: z.enum(PROVIDERS.topup as [string, ...string[]]), idempotencyKey: key }), req.body);
  perUsd(body.currency);
  const t = createTopup({ userId: req.user.id, currency: body.currency, amount: body.amount, method: 'topup', provider: body.provider, idempotencyKey: body.idempotencyKey });
  res.status(201);
  return presentTx(t, req.user.id);
}));

function senderNameOf(t: TxRow) {
  const sender = getUser(t.user_id);
  return sender ? fullName(sender) : undefined;
}

moneyRouter.get('/transactions', h((req) => {
  const q = parse(z.object({
    q: z.string().trim().max(60).optional(), type: z.string().max(20).optional(), status: z.string().max(20).optional(), currency: z.string().length(3).optional(),
    direction: z.enum(['in', 'out']).optional(), page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(30),
  }), req.query);
  const where = ["(t.user_id = @me OR (t.counterparty_id = @me AND t.status IN ('completed','reversed')))"];
  const params: Record<string, unknown> = { me: req.user.id };
  if (q.q) {
    where.push("(t.reference LIKE @q ESCAPE '\\' OR t.counterparty_name LIKE @q ESCAPE '\\' OR t.note LIKE @q ESCAPE '\\' OR (u.first_name || ' ' || u.last_name) LIKE @q ESCAPE '\\')");
    params.q = `%${q.q.replace(/[\\%_]/g, '\\$&')}%`;
  }
  if (q.type) { where.push('t.type = @type'); params.type = q.type; }
  if (q.status) { where.push('t.status = @status'); params.status = q.status; }
  if (q.currency) { where.push('(t.send_currency = @cur OR t.receive_currency = @cur)'); params.cur = q.currency.toUpperCase(); }
  if (q.direction === 'in') where.push("(t.counterparty_id = @me OR t.type IN ('topup','bonus','pot_withdrawal'))");
  if (q.direction === 'out') where.push("(t.user_id = @me AND t.type NOT IN ('topup','bonus','pot_withdrawal'))");
  const clause = where.join(' AND ');
  const from = 'FROM transactions t JOIN users u ON u.id = t.user_id';
  const total = (db.prepare(`SELECT COUNT(*) AS n ${from} WHERE ${clause}`).get(params) as { n: number }).n;
  const rows = db.prepare(`SELECT t.* ${from} WHERE ${clause} ORDER BY t.created_at DESC, t.rowid DESC LIMIT @limit OFFSET @offset`).all({ ...params, limit: q.limit, offset: (q.page - 1) * q.limit }) as TxRow[];
  return { items: rows.map((t) => presentTx(t, req.user.id, senderNameOf(t))), page: q.page, total, hasMore: q.page * q.limit < total };
}));

moneyRouter.get('/transactions/:id', h((req) => {
  const t = getTx(req.params.id);
  const visible = t && (t.user_id === req.user.id || (t.counterparty_id === req.user.id && ['completed', 'reversed'].includes(t.status)));
  if (!visible) throw notFound('Transaction');
  return presentTx(t, req.user.id, senderNameOf(t));
}));
