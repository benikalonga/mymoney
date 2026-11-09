import { db } from '../db';
import { ApiError } from '../lib/http';
import { newId, now } from '../lib/ids';

export type AccountKind = 'wallet' | 'pot' | 'clearing' | 'fees' | 'fx' | 'external' | 'promo' | 'adjustment';

export interface Account {
  id: string;
  kind: AccountKind;
  user_id: string | null;
  currency: string;
  balance: number;
}

export interface Leg {
  account: Account;
  amount: number;
}

const GUARDED = new Set<AccountKind>(['wallet', 'pot', 'clearing']);

const insertAccount = db.prepare('INSERT INTO accounts (id, kind, user_id, currency, created_at) VALUES (?,?,?,?,?)');
const accountById = db.prepare('SELECT * FROM accounts WHERE id = ?');
const systemLookup = db.prepare('SELECT * FROM accounts WHERE kind = ? AND currency = ? AND user_id IS NULL');
const walletLookup = db.prepare("SELECT * FROM accounts WHERE kind = 'wallet' AND user_id = ? AND currency = ?");
const applyBalance = db.prepare('UPDATE accounts SET balance = balance + ? WHERE id = ?');
const insertEntry = db.prepare('INSERT INTO entries (transaction_id, account_id, amount, created_at) VALUES (?,?,?,?)');

export function systemAccount(kind: AccountKind, currency: string): Account {
  const found = systemLookup.get(kind, currency) as Account | undefined;
  if (found) return found;
  const id = newId();
  insertAccount.run(id, kind, null, currency, now());
  return accountById.get(id) as Account;
}

export function findWallet(userId: string, currency: string) {
  return walletLookup.get(userId, currency) as Account | undefined;
}

export function ensureWallet(userId: string, currency: string): Account {
  const found = findWallet(userId, currency);
  if (found) return found;
  const id = newId();
  insertAccount.run(id, 'wallet', userId, currency, now());
  return accountById.get(id) as Account;
}

export function createPotAccount(userId: string, currency: string): Account {
  const id = newId();
  insertAccount.run(id, 'pot', userId, currency, now());
  return accountById.get(id) as Account;
}

export const getAccount = (id: string) => accountById.get(id) as Account;

/**
 * Posts one balanced set of movements. Each currency must net to zero, and no
 * wallet, pot or clearing account may go below zero. Must run inside `tx`.
 */
export function post(transactionId: string, legs: Leg[]) {
  const live = legs.filter((leg) => leg.amount !== 0);
  const totals = new Map<string, number>();
  for (const leg of live) {
    if (!Number.isSafeInteger(leg.amount)) throw new Error('Ledger amounts must be safe integers');
    totals.set(leg.account.currency, (totals.get(leg.account.currency) ?? 0) + leg.amount);
  }
  for (const [currency, total] of totals) {
    if (total !== 0) throw new Error(`Unbalanced ledger posting in ${currency}: ${total}`);
  }

  const stamp = now();
  for (const leg of live) {
    const current = getAccount(leg.account.id);
    if (GUARDED.has(current.kind) && current.balance + leg.amount < 0) {
      throw new ApiError(422, 'INSUFFICIENT_FUNDS', `Not enough ${current.currency} available for this`);
    }
    applyBalance.run(leg.amount, leg.account.id);
    insertEntry.run(transactionId, leg.account.id, leg.amount, stamp);
  }
}

/** Undoes every movement recorded against a transaction. */
export function reverseEntries(transactionId: string) {
  const rows = db.prepare('SELECT account_id, amount FROM entries WHERE transaction_id = ?').all(transactionId) as { account_id: string; amount: number }[];
  const net = new Map<string, number>();
  for (const row of rows) net.set(row.account_id, (net.get(row.account_id) ?? 0) + row.amount);
  post(transactionId, [...net].map(([id, amount]) => ({ account: getAccount(id), amount: -amount })));
}

export interface LedgerHealth {
  healthy: boolean;
  unbalancedCurrencies: { currency: string; total: number }[];
  mismatchedAccounts: { id: string; balance: number; computed: number }[];
  negativeAccounts: number;
  clearingHeld: { currency: string; balance: number }[];
}

export function ledgerHealth(): LedgerHealth {
  const unbalancedCurrencies = db.prepare(`
    SELECT a.currency, SUM(e.amount) AS total FROM entries e JOIN accounts a ON a.id = e.account_id
    GROUP BY a.currency HAVING total <> 0`).all() as LedgerHealth['unbalancedCurrencies'];
  const mismatchedAccounts = db.prepare(`
    SELECT a.id, a.balance, COALESCE(SUM(e.amount), 0) AS computed FROM accounts a
    LEFT JOIN entries e ON e.account_id = a.id GROUP BY a.id HAVING a.balance <> computed`).all() as LedgerHealth['mismatchedAccounts'];
  const negative = db.prepare("SELECT COUNT(*) AS n FROM accounts WHERE kind IN ('wallet','pot','clearing') AND balance < 0").get() as { n: number };
  const clearingHeld = db.prepare("SELECT currency, balance FROM accounts WHERE kind = 'clearing' AND balance <> 0").all() as LedgerHealth['clearingHeld'];
  return {
    healthy: unbalancedCurrencies.length === 0 && mismatchedAccounts.length === 0 && negative.n === 0,
    unbalancedCurrencies,
    mismatchedAccounts,
    negativeAccounts: negative.n,
    clearingHeld,
  };
}
