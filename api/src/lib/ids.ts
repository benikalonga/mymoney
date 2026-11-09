import { randomBytes, randomInt, randomUUID } from 'node:crypto';

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export const newId = () => randomUUID();
export const now = () => new Date().toISOString();

function code(length: number) {
  const bytes = randomBytes(length);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

export const newReference = () => `MM-${code(8)}`;
export const newReferralCode = () => code(7);
export const newProviderRef = () => `prv_${randomBytes(9).toString('hex')}`;
export const fourDigits = () => String(randomInt(1000, 10000));
