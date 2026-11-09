import type { NextFunction, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { db } from '../db';
import { getUser, type UserRow } from '../services/core';
import { ApiError } from './http';
import { newId, now } from './ids';

export interface StaffRow { id: string; email: string; name: string; password_hash: string; role: 'owner' | 'agent'; active: number; created_at: string }

declare global {
  namespace Express {
    interface Request { user: UserRow; sessionId: string; staff: StaffRow; rawBody?: Buffer }
  }
}

const unauthorized = () => new ApiError(401, 'UNAUTHORIZED', 'Please sign in again');
const verifyOptions = { algorithms: ['HS256' as const] };

export function startSession(userId: string, device: string) {
  const id = newId();
  const stamp = now();
  const expires = new Date(Date.now() + config.sessionDays * 86_400_000).toISOString();
  db.prepare('INSERT INTO sessions (id, user_id, device, created_at, last_seen_at, expires_at) VALUES (?,?,?,?,?,?)').run(id, userId, device.slice(0, 80), stamp, stamp, expires);
  return jwt.sign({ sid: id }, config.jwtSecret, { subject: userId, audience: 'customer', expiresIn: `${config.sessionDays}d`, algorithm: 'HS256' });
}

export function requireUser(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization ?? '';
    if (!header.startsWith('Bearer ')) throw unauthorized();
    let payload: jwt.JwtPayload;
    try {
      payload = jwt.verify(header.slice(7), config.jwtSecret, { ...verifyOptions, audience: 'customer' }) as jwt.JwtPayload;
    } catch {
      throw unauthorized();
    }
    const session = db.prepare('SELECT * FROM sessions WHERE id = ? AND user_id = ?').get(payload.sid, payload.sub) as { id: string; revoked_at: string | null; expires_at: string; last_seen_at: string } | undefined;
    if (!session || session.revoked_at || session.expires_at <= now()) throw unauthorized();
    const user = getUser(payload.sub!);
    if (!user || user.status === 'closed') throw unauthorized();
    if (Date.now() - Date.parse(session.last_seen_at) > 60_000) db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').run(now(), session.id);
    req.user = user;
    req.sessionId = session.id;
    next();
  } catch (err) {
    next(err);
  }
}

export function staffToken(staff: StaffRow) {
  return jwt.sign({}, config.jwtSecret, { subject: staff.id, audience: 'staff', expiresIn: '12h', algorithm: 'HS256' });
}

export function requireStaff(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization ?? '';
    if (!header.startsWith('Bearer ')) throw unauthorized();
    let payload: jwt.JwtPayload;
    try {
      payload = jwt.verify(header.slice(7), config.jwtSecret, { ...verifyOptions, audience: 'staff' }) as jwt.JwtPayload;
    } catch {
      throw unauthorized();
    }
    const staff = db.prepare('SELECT * FROM staff WHERE id = ? AND active = 1').get(payload.sub) as StaffRow | undefined;
    if (!staff) throw unauthorized();
    req.staff = staff;
    next();
  } catch (err) {
    next(err);
  }
}

export function requireOwner(req: Request, _res: Response, next: NextFunction) {
  next(req.staff.role === 'owner' ? undefined : new ApiError(403, 'OWNER_ONLY', 'Only owners can do this'));
}

export const hashSecret = (value: string) => bcrypt.hash(value, config.isTest ? 4 : 10);
const DUMMY_HASH = bcrypt.hashSync('not-a-real-secret', 4);

/** Compares against a fixed hash so unknown accounts take about as long to reject. */
export const burnCompare = (value: string) => bcrypt.compare(value, DUMMY_HASH);

const WEAK_PINS = new Set(['123456', '654321', '000000', '111111', '222222', '333333', '444444', '555555', '666666', '777777', '888888', '999999', '121212']);
export function assertStrongPin(pin: string) {
  if (WEAK_PINS.has(pin)) throw new ApiError(422, 'WEAK_PIN', 'Choose a PIN that is harder to guess');
}

/** Checks a PIN and applies the lockout policy. */
export async function verifyPin(user: UserRow, pin: string) {
  const lockedUntil = (db.prepare('SELECT locked_until FROM users WHERE id = ?').get(user.id) as { locked_until: string | null }).locked_until;
  if (lockedUntil && lockedUntil > now()) throw new ApiError(423, 'PIN_LOCKED', `Too many wrong PINs. Try again after ${new Date(lockedUntil).toUTCString()}.`);
  const ok = await bcrypt.compare(pin, user.pin_hash);
  if (ok) {
    db.prepare('UPDATE users SET failed_pins = 0, locked_until = NULL WHERE id = ?').run(user.id);
    return;
  }
  const { failed_pins: failed } = db.prepare('UPDATE users SET failed_pins = failed_pins + 1 WHERE id = ? RETURNING failed_pins').get(user.id) as { failed_pins: number };
  if (failed >= config.pinMaxAttempts) {
    const until = new Date(Date.now() + config.pinLockMinutes * 60_000).toISOString();
    db.prepare('UPDATE users SET failed_pins = 0, locked_until = ? WHERE id = ?').run(until, user.id);
    throw new ApiError(423, 'PIN_LOCKED', `Too many wrong PINs. Your account is locked for ${config.pinLockMinutes} minutes.`);
  }
  throw new ApiError(401, 'WRONG_PIN', `Wrong PIN. ${config.pinMaxAttempts - failed} attempt(s) left.`);
}
