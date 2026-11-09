import 'dotenv/config';

const env = process.env;
const nodeEnv = env.NODE_ENV ?? 'development';
const isProduction = nodeEnv === 'production';

function secret(name: string, devValue: string): string {
  const value = env[name];
  if (value && value.length >= 32) return value;
  if (isProduction) throw new Error(`${name} must be set to at least 32 characters in production`);
  return value ?? devValue;
}

export const config = {
  nodeEnv,
  isProduction,
  isTest: nodeEnv === 'test',
  port: Number(env.PORT ?? 4100),
  dbPath: env.DATABASE_PATH ?? './data/mymoney.db',
  jwtSecret: secret('JWT_SECRET', 'YOUR_SECRETS'),
  webhookSecret: secret('PROVIDER_WEBHOOK_SECRET', 'YOUR_SECRETS'),
  corsOrigins: (env.CORS_ORIGINS ?? 'http://localhost:3100').split(',').map((s) => s.trim()).filter(Boolean),
  providerMode: (env.PROVIDER_MODE ?? 'sandbox') as 'sandbox' | 'live',
  sandboxSettleSeconds: Number(env.SANDBOX_SETTLE_SECONDS ?? 4),
  sessionDays: 30,
  quoteTtlSeconds: 300,
  requestTtlDays: 14,
  pinMaxAttempts: 5,
  pinLockMinutes: 15,
  /** Transfers at or above this USD value (minor units) wait for staff review. */
  reviewThresholdUsd: 300_000,
  /** More than this many transfers in ten minutes also goes to review. */
  velocityLimit: 5,
  referralBonusUsd: 200,
  referralQualifyingUsd: 1_000,
  scheduleMaxFailures: 3,
};
