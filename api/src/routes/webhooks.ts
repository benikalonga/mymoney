import { createHmac, timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config';
import { db } from '../db';
import { ApiError, h, notFound, parse } from '../lib/http';
import type { TxRow } from '../services/core';
import { settleProvider } from '../services/transfers';

export const webhookRouter = Router();

export const signPayload = (raw: Buffer | string) => createHmac('sha256', config.webhookSecret).update(raw).digest('hex');

webhookRouter.post('/webhooks/provider', h((req) => {
  const given = Buffer.from(String(req.headers['x-signature'] ?? ''), 'utf8');
  const expected = Buffer.from(signPayload(req.rawBody ?? ''), 'utf8');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new ApiError(401, 'BAD_SIGNATURE', 'Invalid signature');

  const body = parse(z.object({ providerRef: z.string(), status: z.enum(['success', 'failed']), amount: z.number().int().optional(), reason: z.string().max(200).optional() }), req.body);
  const t = db.prepare('SELECT * FROM transactions WHERE provider_ref = ?').get(body.providerRef) as TxRow | undefined;
  if (!t) throw notFound('Transaction');
  if (t.status !== 'pending') return { ok: true, status: t.status };
  if (body.status === 'success' && t.type === 'topup' && body.amount !== t.send_amount) throw new ApiError(422, 'AMOUNT_MISMATCH', 'The amount does not match this transaction');
  settleProvider(t, body.status === 'success', body.reason);
  return { ok: true };
}));
