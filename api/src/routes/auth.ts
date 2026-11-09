import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { config } from '../config';
import { db, tx } from '../db';
import { ensureWallet } from '../domain/ledger';
import { assertStrongPin, burnCompare, hashSecret, requireUser, startSession, verifyPin } from '../lib/auth';
import { ApiError, h, invalid, parse } from '../lib/http';
import { fourDigits, newId, newReferralCode, now } from '../lib/ids';
import { limitUsage, perUsd, type UserRow } from '../services/core';
import { presentUser } from '../services/present';

export const authRouter = Router();

const limiter = rateLimit({ windowMs: 60_000, max: config.isTest ? 100_000 : 20, standardHeaders: true, legacyHeaders: false, message: { error: { code: 'RATE_LIMITED', message: 'Too many attempts. Please wait a minute.' } } });

const phone = z.string().transform((s) => s.replace(/[\s()-]/g, '')).pipe(z.string().regex(/^\+?[0-9]{8,15}$/, 'Enter a valid phone number'));
const pin = z.string().regex(/^[0-9]{6}$/, 'PIN must be 6 digits');
const name = z.string().trim().min(1).max(60);
const device = z.string().trim().max(80).optional();

function makeTag(firstName: string) {
  const base = firstName.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12) || 'user';
  for (;;) {
    const tag = `${base}${fourDigits()}`;
    if (!db.prepare('SELECT 1 FROM users WHERE tag = ?').get(tag)) return tag;
  }
}

function auth(user: UserRow, deviceName?: string) {
  return { token: startSession(user.id, deviceName || 'Unknown device'), user: presentUser(db.prepare('SELECT * FROM users WHERE id = ?').get(user.id) as UserRow) };
}

authRouter.post('/auth/register', limiter, h(async (req, res) => {
  const body = parse(z.object({ phone, pin, firstName: name, lastName: name, currency: z.string().length(3).default('USD'), referralCode: z.string().trim().toUpperCase().optional(), device }), req.body);
  assertStrongPin(body.pin);
  perUsd(body.currency);
  const pinHash = await hashSecret(body.pin);
  const user = tx(() => {
    if (db.prepare('SELECT 1 FROM users WHERE phone = ?').get(body.phone)) throw new ApiError(409, 'PHONE_TAKEN', 'This phone number already has an account');
    let referredBy: string | null = null;
    if (body.referralCode) {
      const referrer = db.prepare('SELECT id FROM users WHERE referral_code = ?').get(body.referralCode) as { id: string } | undefined;
      if (!referrer) throw invalid('That invite code does not exist', 'BAD_REFERRAL');
      referredBy = referrer.id;
    }
    const id = newId();
    db.prepare(`INSERT INTO users (id, phone, first_name, last_name, tag, pin_hash, default_currency, referral_code, referred_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(id, body.phone, body.firstName, body.lastName, makeTag(body.firstName), pinHash, body.currency, newReferralCode(), referredBy, now());
    ensureWallet(id, body.currency);
    return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow;
  });
  res.status(201);
  return auth(user, body.device);
}));

authRouter.post('/auth/login', limiter, h(async (req) => {
  const body = parse(z.object({ phone, pin: z.string().min(1).max(12), device }), req.body);
  const user = db.prepare('SELECT * FROM users WHERE phone = ?').get(body.phone) as UserRow | undefined;
  if (!user || user.status === 'closed') {
    await burnCompare(body.pin);
    throw new ApiError(401, 'BAD_CREDENTIALS', 'Wrong phone number or PIN');
  }
  try {
    await verifyPin(user, body.pin);
  } catch (err) {
    if (err instanceof ApiError && err.code === 'WRONG_PIN') throw new ApiError(401, 'BAD_CREDENTIALS', 'Wrong phone number or PIN');
    throw err;
  }
  return auth(user, body.device);
}));

authRouter.use(['/auth/logout', '/auth/pin', '/auth/verify-pin', '/me', '/sessions'], requireUser);

authRouter.post('/auth/logout', h((req) => {
  db.prepare('UPDATE sessions SET revoked_at = ? WHERE id = ?').run(now(), req.sessionId);
  return { ok: true };
}));

authRouter.post('/auth/verify-pin', limiter, h(async (req) => {
  await verifyPin(req.user, parse(z.object({ pin: z.string().max(12) }), req.body).pin);
  return { ok: true };
}));

authRouter.post('/auth/pin', limiter, h(async (req) => {
  const body = parse(z.object({ currentPin: z.string().max(12), newPin: pin }), req.body);
  await verifyPin(req.user, body.currentPin);
  assertStrongPin(body.newPin);
  if (body.newPin === body.currentPin) throw invalid('Choose a different PIN');
  db.prepare('UPDATE users SET pin_hash = ? WHERE id = ?').run(await hashSecret(body.newPin), req.user.id);
  db.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND id <> ? AND revoked_at IS NULL').run(now(), req.user.id, req.sessionId);
  return { ok: true };
}));

authRouter.get('/me', h((req) => presentUser(req.user)));

authRouter.patch('/me', h((req) => {
  const body = parse(z.object({
    firstName: name.optional(), lastName: name.optional(), email: z.string().email().max(120).nullable().optional(),
    tag: z.string().trim().toLowerCase().regex(/^[a-z0-9_]{3,20}$/, 'Use 3 to 20 letters, numbers or underscores').optional(),
    defaultCurrency: z.string().length(3).optional(),
  }), req.body);
  if (body.defaultCurrency) perUsd(body.defaultCurrency);
  return tx(() => {
    if (body.tag && db.prepare('SELECT 1 FROM users WHERE tag = ? AND id <> ?').get(body.tag, req.user.id)) throw new ApiError(409, 'TAG_TAKEN', 'That tag is taken');
    if (body.defaultCurrency) ensureWallet(req.user.id, body.defaultCurrency);
    db.prepare(`UPDATE users SET first_name = COALESCE(?, first_name), last_name = COALESCE(?, last_name), email = CASE WHEN ? THEN ? ELSE email END,
      tag = COALESCE(?, tag), default_currency = COALESCE(?, default_currency) WHERE id = ?`)
      .run(body.firstName ?? null, body.lastName ?? null, body.email !== undefined ? 1 : 0, body.email ?? null, body.tag ?? null, body.defaultCurrency ?? null, req.user.id);
    return presentUser(db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id) as UserRow);
  });
}));

authRouter.get('/me/limits', h((req) => ({ tier: req.user.tier, ...limitUsage(req.user) })));

authRouter.get('/sessions', h((req) => {
  const rows = db.prepare('SELECT id, device, created_at, last_seen_at FROM sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ? ORDER BY last_seen_at DESC').all(req.user.id, now()) as { id: string; device: string; created_at: string; last_seen_at: string }[];
  return rows.map((s) => ({ id: s.id, device: s.device, createdAt: s.created_at, lastSeenAt: s.last_seen_at, current: s.id === req.sessionId }));
}));

authRouter.delete('/sessions/:id', h((req) => {
  db.prepare('UPDATE sessions SET revoked_at = ? WHERE id = ? AND user_id = ?').run(now(), req.params.id, req.user.id);
  return { ok: true };
}));
