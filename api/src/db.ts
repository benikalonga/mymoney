import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from './config';

if (config.dbPath !== ':memory:') fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

export const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  phone TEXT NOT NULL UNIQUE,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT,
  tag TEXT NOT NULL UNIQUE,
  pin_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','frozen','closed')),
  tier INTEGER NOT NULL DEFAULT 1 CHECK (tier IN (1,2,3)),
  kyc_status TEXT NOT NULL DEFAULT 'none' CHECK (kyc_status IN ('none','pending','approved','rejected')),
  default_currency TEXT NOT NULL,
  failed_pins INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  referral_code TEXT NOT NULL UNIQUE,
  referred_by TEXT REFERENCES users(id),
  referral_rewarded_at TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  device TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('wallet','pot','clearing','fees','fx','external','promo','adjustment')),
  user_id TEXT REFERENCES users(id),
  currency TEXT NOT NULL,
  balance INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  CHECK (kind NOT IN ('wallet','pot','clearing') OR balance >= 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_unique ON accounts(user_id, currency) WHERE kind = 'wallet';
CREATE UNIQUE INDEX IF NOT EXISTS idx_system_unique ON accounts(kind, currency) WHERE user_id IS NULL;

CREATE TABLE IF NOT EXISTS recipients (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('mymoney','mobile_money','bank')),
  provider TEXT,
  account TEXT NOT NULL,
  currency TEXT NOT NULL,
  counterparty_id TEXT REFERENCES users(id),
  favorite INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT,
  last_used_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_recipients_user ON recipients(user_id);

CREATE TABLE IF NOT EXISTS quotes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  recipient_id TEXT REFERENCES recipients(id),
  method TEXT NOT NULL,
  send_currency TEXT NOT NULL,
  send_amount INTEGER NOT NULL,
  fee INTEGER NOT NULL,
  rate REAL NOT NULL,
  receive_currency TEXT NOT NULL,
  receive_amount INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  reference TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL CHECK (type IN ('topup','transfer','exchange','pot_deposit','pot_withdrawal','bonus','adjustment')),
  status TEXT NOT NULL CHECK (status IN ('processing','review','pending','completed','failed','reversed')),
  user_id TEXT NOT NULL REFERENCES users(id),
  method TEXT,
  provider TEXT,
  payout_account TEXT,
  recipient_id TEXT REFERENCES recipients(id),
  counterparty_id TEXT REFERENCES users(id),
  counterparty_name TEXT,
  send_currency TEXT NOT NULL,
  send_amount INTEGER NOT NULL,
  fee INTEGER NOT NULL DEFAULT 0,
  rate REAL NOT NULL DEFAULT 1,
  receive_currency TEXT NOT NULL,
  receive_amount INTEGER NOT NULL,
  usd_value INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  category TEXT,
  review_reason TEXT,
  failure_reason TEXT,
  idempotency_key TEXT,
  provider_ref TEXT UNIQUE,
  provider_due_at TEXT,
  schedule_id TEXT,
  request_id TEXT,
  pot_id TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tx_idempotency ON transactions(user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tx_user ON transactions(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_tx_counterparty ON transactions(counterparty_id, created_at);
CREATE INDEX IF NOT EXISTS idx_tx_status ON transactions(status);

CREATE TABLE IF NOT EXISTS entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_id TEXT NOT NULL REFERENCES transactions(id),
  account_id TEXT NOT NULL REFERENCES accounts(id),
  amount INTEGER NOT NULL CHECK (amount <> 0),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_entries_tx ON entries(transaction_id);
CREATE INDEX IF NOT EXISTS idx_entries_account ON entries(account_id);

CREATE TABLE IF NOT EXISTS money_requests (
  id TEXT PRIMARY KEY,
  requester_id TEXT NOT NULL REFERENCES users(id),
  payer_id TEXT NOT NULL REFERENCES users(id),
  currency TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  note TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending','paid','declined','cancelled','expired')),
  transaction_id TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_requests_payer ON money_requests(payer_id, status);
CREATE INDEX IF NOT EXISTS idx_requests_requester ON money_requests(requester_id, status);

CREATE TABLE IF NOT EXISTS pots (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  account_id TEXT NOT NULL REFERENCES accounts(id),
  name TEXT NOT NULL,
  target INTEGER NOT NULL CHECK (target > 0),
  target_date TEXT,
  closed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS schedules (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  recipient_id TEXT NOT NULL REFERENCES recipients(id),
  send_currency TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  frequency TEXT NOT NULL CHECK (frequency IN ('weekly','monthly')),
  anchor_day INTEGER NOT NULL,
  note TEXT,
  next_run_at TEXT NOT NULL,
  retry_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('active','paused')),
  failures INTEGER NOT NULL DEFAULT 0,
  last_result TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rate_alerts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  from_currency TEXT NOT NULL,
  to_currency TEXT NOT NULL,
  target REAL NOT NULL CHECK (target > 0),
  direction TEXT NOT NULL CHECK (direction IN ('above','below')),
  active INTEGER NOT NULL DEFAULT 1,
  triggered_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  transaction_id TEXT,
  read_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at);

CREATE TABLE IF NOT EXISTS kyc_submissions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  legal_name TEXT NOT NULL,
  date_of_birth TEXT NOT NULL,
  document_type TEXT NOT NULL CHECK (document_type IN ('national_id','passport','drivers_licence')),
  document_number TEXT NOT NULL,
  address TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','approved','rejected')),
  decision_reason TEXT,
  reviewed_by TEXT,
  reviewed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rates (
  currency TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  per_usd REAL NOT NULL CHECK (per_usd > 0),
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS fee_rules (
  method TEXT PRIMARY KEY,
  percent_bps INTEGER NOT NULL CHECK (percent_bps >= 0),
  flat_usd INTEGER NOT NULL CHECK (flat_usd >= 0)
);
CREATE TABLE IF NOT EXISTS tier_limits (
  tier INTEGER PRIMARY KEY,
  single_usd INTEGER NOT NULL,
  daily_usd INTEGER NOT NULL,
  monthly_usd INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS staff (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner','agent')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  staff_id TEXT NOT NULL,
  staff_name TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL
);
`);

const stamp = new Date().toISOString();
const seedRate = db.prepare('INSERT OR IGNORE INTO rates (currency, name, per_usd, updated_at) VALUES (?,?,?,?)');
for (const [code, name, perUsd] of [
  ['USD', 'US Dollar', 1],
  ['EUR', 'Euro', 0.92],
  ['GBP', 'British Pound', 0.79],
  ['ZAR', 'South African Rand', 18.2],
  ['KES', 'Kenyan Shilling', 129],
  ['NGN', 'Nigerian Naira', 1540],
  ['GHS', 'Ghanaian Cedi', 15.2],
] as const) seedRate.run(code, name, perUsd, stamp);

db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('spread_bps', '100')").run();

const seedFee = db.prepare('INSERT OR IGNORE INTO fee_rules (method, percent_bps, flat_usd) VALUES (?,?,?)');
seedFee.run('mymoney', 0, 0);
seedFee.run('mobile_money', 150, 0);
seedFee.run('bank', 100, 100);
seedFee.run('exchange', 50, 0);

const seedLimit = db.prepare('INSERT OR IGNORE INTO tier_limits (tier, single_usd, daily_usd, monthly_usd) VALUES (?,?,?,?)');
seedLimit.run(1, 50_000, 100_000, 300_000);
seedLimit.run(2, 500_000, 1_000_000, 3_000_000);
seedLimit.run(3, 2_500_000, 5_000_000, 15_000_000);

/** Runs `fn` atomically. Anything thrown inside rolls back every write. */
export const tx = <T>(fn: () => T): T => db.transaction(fn).immediate();
