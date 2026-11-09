import type { Request } from 'express';
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { config } from '../config';
import { db, tx } from '../db';
import { ensureWallet, ledgerHealth, post, systemAccount } from '../domain/ledger';
import { burnCompare, hashSecret, requireOwner, requireStaff, staffToken, type StaffRow } from '../lib/auth';
import { ApiError, h, invalid, notFound, parse } from '../lib/http';
import { newId, now } from '../lib/ids';
import { formatMoney, getTx, getUser, limitUsage, notify, perUsd, type TxRow, type UserRow } from '../services/core';
import { presentUser } from '../services/present';
import { approveReview, createTx, rejectReview, reverseTransaction } from '../services/transfers';

export const adminRouter = Router();

const limiter = rateLimit({ windowMs: 60_000, max: config.isTest ? 100_000 : 10, standardHeaders: true, legacyHeaders: false, message: { error: { code: 'RATE_LIMITED', message: 'Too many attempts. Please wait a minute.' } } });
const reason = z.object({ reason: z.string().trim().min(3).max(200) });
const presentStaff = (s: StaffRow) => ({ id: s.id, email: s.email, name: s.name, role: s.role, active: !!s.active, createdAt: s.created_at });

function audit(req: Request, action: string, targetType: string, targetId: string, detail?: string) {
  db.prepare('INSERT INTO audit_log (staff_id, staff_name, action, target_type, target_id, detail, created_at) VALUES (?,?,?,?,?,?,?)')
    .run(req.staff.id, req.staff.name, action, targetType, targetId, detail ?? null, now());
}

adminRouter.post('/admin/auth/login', limiter, h(async (req) => {
  const body = parse(z.object({ email: z.string().email().toLowerCase(), password: z.string().min(1).max(200) }), req.body);
  const staff = db.prepare('SELECT * FROM staff WHERE email = ? AND active = 1').get(body.email) as StaffRow | undefined;
  const ok = staff ? await bcrypt.compare(body.password, staff.password_hash) : await burnCompare(body.password);
  if (!staff || !ok) throw new ApiError(401, 'BAD_CREDENTIALS', 'Wrong email or password');
  return { token: staffToken(staff), staff: presentStaff(staff) };
}));

adminRouter.use('/admin', requireStaff);

adminRouter.get('/admin/me', h((req) => presentStaff(req.staff)));

adminRouter.get('/admin/overview', h(() => {
  const today = now().slice(0, 10);
  const count = (sql: string, ...args: unknown[]) => (db.prepare(sql).get(...args) as { n: number }).n;
  const since = new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10);
  const daily = db.prepare(`SELECT substr(created_at,1,10) AS day, SUM(usd_value) AS usd, COUNT(*) AS count FROM transactions
    WHERE type = 'transfer' AND status = 'completed' AND created_at >= ? GROUP BY day ORDER BY day`).all(since) as { day: string; usd: number; count: number }[];
  const byDay = new Map(daily.map((d) => [d.day, d]));
  const series = Array.from({ length: 30 }, (_, i) => {
    const day = new Date(Date.now() - (29 - i) * 86_400_000).toISOString().slice(0, 10);
    return { day, usd: byDay.get(day)?.usd ?? 0, count: byDay.get(day)?.count ?? 0 };
  });
  const fees = db.prepare("SELECT currency, balance FROM accounts WHERE kind = 'fees' AND balance <> 0").all() as { currency: string; balance: number }[];
  const float = db.prepare("SELECT currency, SUM(balance) AS balance FROM accounts WHERE kind IN ('wallet','pot') GROUP BY currency HAVING SUM(balance) <> 0 ORDER BY currency").all() as { currency: string; balance: number }[];
  return {
    customers: count('SELECT COUNT(*) AS n FROM users'),
    newToday: count('SELECT COUNT(*) AS n FROM users WHERE created_at LIKE ?', `${today}%`),
    frozen: count("SELECT COUNT(*) AS n FROM users WHERE status = 'frozen'"),
    kycPending: count("SELECT COUNT(*) AS n FROM kyc_submissions WHERE status = 'pending'"),
    reviewQueue: count("SELECT COUNT(*) AS n FROM transactions WHERE status = 'review'"),
    inFlight: count("SELECT COUNT(*) AS n FROM transactions WHERE status = 'pending'"),
    volumeTodayUsd: series[series.length - 1].usd,
    transfersToday: series[series.length - 1].count,
    feesUsd: Math.round(fees.reduce((sum, f) => sum + f.balance / perUsd(f.currency), 0)),
    series, float,
    ledgerHealthy: ledgerHealth().healthy,
  };
}));

function txFilters(q: { q?: string; status?: string; type?: string; userId?: string }) {
  const where: string[] = ['1 = 1'];
  const params: Record<string, unknown> = {};
  if (q.q) {
    where.push("(t.reference LIKE @q ESCAPE '\\' OR t.counterparty_name LIKE @q ESCAPE '\\' OR u.phone LIKE @q ESCAPE '\\' OR (u.first_name || ' ' || u.last_name) LIKE @q ESCAPE '\\')");
    params.q = `%${q.q.replace(/[\\%_]/g, '\\$&')}%`;
  }
  if (q.status) { where.push('t.status = @status'); params.status = q.status; }
  if (q.type) { where.push('t.type = @type'); params.type = q.type; }
  if (q.userId) { where.push('(t.user_id = @userId OR t.counterparty_id = @userId)'); params.userId = q.userId; }
  return { clause: where.join(' AND '), params };
}

type AdminTx = TxRow & { customer_name: string; customer_phone: string };
const presentAdminTx = (t: AdminTx) => ({
  id: t.id, reference: t.reference, type: t.type, status: t.status, method: t.method, provider: t.provider, userId: t.user_id, customerName: t.customer_name, customerPhone: t.customer_phone,
  counterpartyId: t.counterparty_id, counterpartyName: t.counterparty_name, payoutAccount: t.payout_account, sendCurrency: t.send_currency, sendAmount: t.send_amount, fee: t.fee, rate: t.rate, receiveCurrency: t.receive_currency, receiveAmount: t.receive_amount,
  usdValue: t.usd_value, note: t.note, category: t.category, reviewReason: t.review_reason, failureReason: t.failure_reason, providerRef: t.provider_ref, createdAt: t.created_at, completedAt: t.completed_at,
});
const txFrom = "FROM transactions t JOIN users u ON u.id = t.user_id";
const txSelect = `SELECT t.*, u.first_name || ' ' || u.last_name AS customer_name, u.phone AS customer_phone ${txFrom}`;

/** Stops spreadsheet apps from running a cell as a formula. */
function csvCell(value: unknown) {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

adminRouter.get('/admin/transactions', h((req, res) => {
  const q = parse(z.object({
    q: z.string().trim().max(60).optional(), status: z.string().max(20).optional(), type: z.string().max(20).optional(), userId: z.string().max(40).optional(),
    page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(25), format: z.enum(['json', 'csv']).default('json'),
  }), req.query);
  const { clause, params } = txFilters(q);
  if (q.format === 'csv') {
    const rows = db.prepare(`${txSelect} WHERE ${clause} ORDER BY t.created_at DESC LIMIT 10000`).all(params) as AdminTx[];
    const header = 'reference,created_at,type,status,customer,phone,counterparty,send_currency,send_amount,fee,rate,receive_currency,receive_amount,usd_value';
    const lines = rows.map((t) => [t.reference, t.created_at, t.type, t.status, t.customer_name, t.customer_phone, t.counterparty_name, t.send_currency, (t.send_amount / 100).toFixed(2), (t.fee / 100).toFixed(2), t.rate, t.receive_currency, (t.receive_amount / 100).toFixed(2), (t.usd_value / 100).toFixed(2)].map(csvCell).join(','));
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="transactions.csv"');
    res.send([header, ...lines].join('\n'));
    return;
  }
  const total = (db.prepare(`SELECT COUNT(*) AS n ${txFrom} WHERE ${clause}`).get(params) as { n: number }).n;
  const rows = db.prepare(`${txSelect} WHERE ${clause} ORDER BY t.created_at DESC, t.rowid DESC LIMIT @limit OFFSET @offset`).all({ ...params, limit: q.limit, offset: (q.page - 1) * q.limit }) as AdminTx[];
  return { items: rows.map(presentAdminTx), total, page: q.page, limit: q.limit };
}));

adminRouter.get('/admin/transactions/:id', h((req) => {
  const t = db.prepare(`${txSelect} WHERE t.id = ?`).get(req.params.id) as AdminTx | undefined;
  if (!t) throw notFound('Transaction');
  const entries = db.prepare(`SELECT e.id, e.amount, e.created_at AS createdAt, a.kind, a.currency, a.user_id AS userId FROM entries e JOIN accounts a ON a.id = e.account_id WHERE e.transaction_id = ? ORDER BY e.id`).all(t.id);
  return { ...presentAdminTx(t), entries };
}));

adminRouter.post('/admin/transactions/:id/approve', h((req) => {
  const t = approveReview(req.params.id);
  audit(req, 'transaction.approve', 'transaction', t.reference);
  return { status: t.status };
}));
adminRouter.post('/admin/transactions/:id/reject', h((req) => {
  const body = parse(reason, req.body);
  const t = rejectReview(req.params.id, body.reason);
  audit(req, 'transaction.reject', 'transaction', t.reference, body.reason);
  return { status: t.status };
}));
adminRouter.post('/admin/transactions/:id/reverse', requireOwner, h((req) => {
  const body = parse(reason, req.body);
  const t = reverseTransaction(req.params.id, body.reason);
  audit(req, 'transaction.reverse', 'transaction', t.reference, body.reason);
  return { status: t.status };
}));

adminRouter.get('/admin/users', h((req) => {
  const q = parse(z.object({ q: z.string().trim().max(60).optional(), status: z.string().max(20).optional(), page: z.coerce.number().int().min(1).default(1) }), req.query);
  const where = ['1 = 1'];
  const params: Record<string, unknown> = {};
  if (q.q) { where.push("(phone LIKE @q ESCAPE '\\' OR tag LIKE @q ESCAPE '\\' OR (first_name || ' ' || last_name) LIKE @q ESCAPE '\\')"); params.q = `%${q.q.replace(/[\\%_]/g, '\\$&')}%`; }
  if (q.status) { where.push('status = @status'); params.status = q.status; }
  const clause = where.join(' AND ');
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM users WHERE ${clause}`).get(params) as { n: number }).n;
  const rows = db.prepare(`SELECT * FROM users WHERE ${clause} ORDER BY created_at DESC LIMIT 25 OFFSET @offset`).all({ ...params, offset: (q.page - 1) * 25 }) as UserRow[];
  return { items: rows.map(presentUser), total, page: q.page, limit: 25 };
}));

adminRouter.get('/admin/users/:id', h((req) => {
  const user = getUser(req.params.id);
  if (!user) throw notFound('Customer');
  const wallets = db.prepare("SELECT kind, currency, balance FROM accounts WHERE user_id = ? ORDER BY kind DESC, currency").all(user.id);
  const kyc = db.prepare('SELECT legal_name AS legalName, date_of_birth AS dateOfBirth, document_type AS documentType, document_number AS documentNumber, address, status, decision_reason AS reason, created_at AS createdAt FROM kyc_submissions WHERE user_id = ? ORDER BY created_at DESC').all(user.id);
  return { ...presentUser(user), wallets, kyc, limits: limitUsage(user), locked: !!user.locked_until && user.locked_until > now() };
}));

adminRouter.patch('/admin/users/:id', h((req) => {
  const body = parse(z.object({ status: z.enum(['active', 'frozen']).optional(), tier: z.number().int().min(1).max(3).optional(), reason: z.string().trim().min(3).max(200) }), req.body);
  const user = getUser(req.params.id);
  if (!user) throw notFound('Customer');
  if (body.tier !== undefined && req.staff.role !== 'owner') throw new ApiError(403, 'OWNER_ONLY', 'Only owners can change tiers');
  tx(() => {
    db.prepare('UPDATE users SET status = COALESCE(?, status), tier = COALESCE(?, tier) WHERE id = ?').run(body.status ?? null, body.tier ?? null, user.id);
    if (body.status && body.status !== user.status) notify(user.id, 'account', body.status === 'frozen' ? 'Account frozen' : 'Account restored', body.status === 'frozen' ? 'Your account was frozen. Please contact support.' : 'You can use your account again.');
    audit(req, 'customer.update', 'customer', user.id, `${JSON.stringify({ status: body.status, tier: body.tier })}: ${body.reason}`);
  });
  return presentUser(getUser(user.id)!);
}));

adminRouter.post('/admin/users/:id/unlock', h((req) => {
  const user = getUser(req.params.id);
  if (!user) throw notFound('Customer');
  db.prepare('UPDATE users SET failed_pins = 0, locked_until = NULL WHERE id = ?').run(user.id);
  audit(req, 'customer.unlock', 'customer', user.id);
  return { ok: true };
}));

adminRouter.post('/admin/users/:id/adjust', requireOwner, h((req, res) => {
  const body = parse(z.object({ currency: z.string().length(3).toUpperCase(), amount: z.number().int().refine((n) => n !== 0, 'Amount cannot be zero'), reason: z.string().trim().min(3).max(200) }), req.body);
  perUsd(body.currency);
  const user = getUser(req.params.id);
  if (!user) throw notFound('Customer');
  const t = tx(() => {
    const abs = Math.abs(body.amount);
    const t = createTx({ type: 'adjustment', status: 'completed', user_id: user.id, counterparty_name: 'Balance adjustment', send_currency: body.currency, send_amount: abs, receive_currency: body.currency, receive_amount: abs, note: body.reason, completed_at: now() });
    post(t.id, [{ account: ensureWallet(user.id, body.currency), amount: body.amount }, { account: systemAccount('adjustment', body.currency), amount: -body.amount }]);
    notify(user.id, 'adjustment', 'Balance adjusted', `${body.amount > 0 ? 'Added' : 'Removed'} ${formatMoney(abs, body.currency)}: ${body.reason}`, t.id);
    audit(req, 'customer.adjust', 'customer', user.id, `${formatMoney(body.amount, body.currency)}: ${body.reason}`);
    return t;
  });
  res.status(201);
  return { reference: t.reference };
}));

adminRouter.get('/admin/kyc', h((req) => {
  const status = parse(z.object({ status: z.enum(['pending', 'approved', 'rejected']).default('pending') }), req.query).status;
  return db.prepare(`SELECT k.id, k.user_id AS userId, u.first_name || ' ' || u.last_name AS customerName, u.phone, k.legal_name AS legalName, k.date_of_birth AS dateOfBirth, k.document_type AS documentType,
    k.document_number AS documentNumber, k.address, k.status, k.decision_reason AS reason, k.created_at AS createdAt FROM kyc_submissions k JOIN users u ON u.id = k.user_id WHERE k.status = ? ORDER BY k.created_at`).all(status);
}));

adminRouter.post('/admin/kyc/:id', h((req) => {
  const body = parse(z.object({ decision: z.enum(['approved', 'rejected']), reason: z.string().trim().max(200).optional() }), req.body);
  if (body.decision === 'rejected' && !body.reason) throw invalid('A reason is required to reject a verification');
  return tx(() => {
    const k = db.prepare('SELECT * FROM kyc_submissions WHERE id = ?').get(req.params.id) as { id: string; user_id: string; status: string } | undefined;
    if (!k) throw notFound('Verification');
    if (k.status !== 'pending') throw new ApiError(409, 'INVALID_STATE', 'This verification was already decided');
    db.prepare('UPDATE kyc_submissions SET status = ?, decision_reason = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?').run(body.decision, body.reason ?? null, req.staff.id, now(), k.id);
    if (body.decision === 'approved') {
      db.prepare("UPDATE users SET kyc_status = 'approved', tier = MAX(tier, 2) WHERE id = ?").run(k.user_id);
      notify(k.user_id, 'kyc', 'Identity verified', 'Your limits have been raised.');
    } else {
      db.prepare("UPDATE users SET kyc_status = 'rejected' WHERE id = ?").run(k.user_id);
      notify(k.user_id, 'kyc', 'Verification not approved', body.reason!);
    }
    audit(req, `kyc.${body.decision}`, 'customer', k.user_id, body.reason);
    return { status: body.decision };
  });
}));

adminRouter.get('/admin/pricing', h(() => ({
  rates: db.prepare('SELECT currency, name, per_usd AS perUsd, updated_at AS updatedAt FROM rates ORDER BY currency').all(),
  spreadBps: Number((db.prepare("SELECT value FROM settings WHERE key = 'spread_bps'").get() as { value: string }).value),
  fees: db.prepare('SELECT method, percent_bps AS percentBps, flat_usd AS flatUsd FROM fee_rules').all(),
  limits: db.prepare('SELECT tier, single_usd AS singleUsd, daily_usd AS dailyUsd, monthly_usd AS monthlyUsd FROM tier_limits ORDER BY tier').all(),
})));

adminRouter.patch('/admin/pricing/rates/:currency', requireOwner, h((req) => {
  const body = parse(z.object({ perUsd: z.number().positive().max(1_000_000) }), req.body);
  if (req.params.currency === 'USD') throw invalid('USD is the base currency and stays at 1');
  if (!db.prepare('UPDATE rates SET per_usd = ?, updated_at = ? WHERE currency = ?').run(body.perUsd, now(), req.params.currency).changes) throw notFound('Currency');
  audit(req, 'pricing.rate', 'currency', req.params.currency, String(body.perUsd));
  return { ok: true };
}));
adminRouter.patch('/admin/pricing/spread', requireOwner, h((req) => {
  const body = parse(z.object({ spreadBps: z.number().int().min(0).max(1000) }), req.body);
  db.prepare("UPDATE settings SET value = ? WHERE key = 'spread_bps'").run(String(body.spreadBps));
  audit(req, 'pricing.spread', 'setting', 'spread_bps', String(body.spreadBps));
  return { ok: true };
}));
adminRouter.patch('/admin/pricing/fees/:method', requireOwner, h((req) => {
  const body = parse(z.object({ percentBps: z.number().int().min(0).max(2000), flatUsd: z.number().int().min(0).max(10_000) }), req.body);
  if (!db.prepare('UPDATE fee_rules SET percent_bps = ?, flat_usd = ? WHERE method = ?').run(body.percentBps, body.flatUsd, req.params.method).changes) throw notFound('Fee rule');
  audit(req, 'pricing.fee', 'fee_rule', req.params.method, JSON.stringify(body));
  return { ok: true };
}));
adminRouter.patch('/admin/pricing/limits/:tier', requireOwner, h((req) => {
  const body = parse(z.object({ singleUsd: z.number().int().positive(), dailyUsd: z.number().int().positive(), monthlyUsd: z.number().int().positive() }), req.body);
  if (!db.prepare('UPDATE tier_limits SET single_usd = ?, daily_usd = ?, monthly_usd = ? WHERE tier = ?').run(body.singleUsd, body.dailyUsd, body.monthlyUsd, req.params.tier).changes) throw notFound('Tier');
  audit(req, 'pricing.limits', 'tier', req.params.tier, JSON.stringify(body));
  return { ok: true };
}));

adminRouter.get('/admin/team', requireOwner, h(() => (db.prepare('SELECT * FROM staff ORDER BY created_at').all() as StaffRow[]).map(presentStaff)));
adminRouter.post('/admin/team', requireOwner, h(async (req, res) => {
  const body = parse(z.object({ email: z.string().email().toLowerCase(), name: z.string().trim().min(2).max(80), password: z.string().min(12).max(200), role: z.enum(['owner', 'agent']) }), req.body);
  if (db.prepare('SELECT 1 FROM staff WHERE email = ?').get(body.email)) throw new ApiError(409, 'EMAIL_TAKEN', 'That email already has an account');
  const id = newId();
  db.prepare('INSERT INTO staff (id, email, name, password_hash, role, created_at) VALUES (?,?,?,?,?,?)').run(id, body.email, body.name, await hashSecret(body.password), body.role, now());
  audit(req, 'team.add', 'staff', id, body.email);
  res.status(201);
  return presentStaff(db.prepare('SELECT * FROM staff WHERE id = ?').get(id) as StaffRow);
}));
adminRouter.patch('/admin/team/:id', requireOwner, h((req) => {
  const body = parse(z.object({ active: z.boolean() }), req.body);
  if (req.params.id === req.staff.id) throw invalid('You cannot change your own access');
  if (!db.prepare('UPDATE staff SET active = ? WHERE id = ?').run(Number(body.active), req.params.id).changes) throw notFound('Staff member');
  audit(req, body.active ? 'team.activate' : 'team.deactivate', 'staff', req.params.id);
  return { ok: true };
}));

adminRouter.get('/admin/audit', h((req) => {
  const page = parse(z.object({ page: z.coerce.number().int().min(1).default(1) }), req.query).page;
  const total = (db.prepare('SELECT COUNT(*) AS n FROM audit_log').get() as { n: number }).n;
  const items = db.prepare('SELECT id, staff_name AS staffName, action, target_type AS targetType, target_id AS targetId, detail, created_at AS createdAt FROM audit_log ORDER BY id DESC LIMIT 50 OFFSET ?').all((page - 1) * 50);
  return { items, total, page, limit: 50 };
}));

adminRouter.get('/admin/ledger/health', h(() => ledgerHealth()));

export { getTx };
