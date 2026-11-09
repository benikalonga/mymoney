# MyMoney

**A multi-currency wallet and money transfer platform for people who send money across borders.**

Customers hold balances in several currencies, pay friends instantly, send to banks and mobile money, request
payments, exchange currencies, schedule regular payments and save toward goals. A staff console handles fraud review,
identity checks, pricing and refunds. Every cent moves through a double-entry ledger.

The project has three parts:

| Folder | What it is | Built with |
|---|---|---|
| [`api/`](api) | REST API, ledger and background jobs | Node.js 22, Express, TypeScript, SQLite (better-sqlite3), Zod |
| [`mobile/`](mobile) | Customer app for iOS and Android | Expo SDK 58, React Native, Zustand, React Navigation |
| [`console/`](console) | Staff operations console | Next.js 15, React 19 |

> **MyMoney is software, not a licensed financial service.** Top-ups and payouts run against a built-in sandbox, so no
> real money moves. Going live needs real payment partners, the licences your market requires, and a compliance programme.

---

## Features

### Customer app

- **Multi-currency wallets:** hold USD, EUR, GBP, ZAR, KES, NGN and GHS, with a combined total in your main currency.
- **Send money:** to another MyMoney user (instant), mobile money or a bank account.
- **Locked quotes:** see the rate, fee and exact amount received, held for 5 minutes.
- **Saved recipients:** favourites, and name lookup by phone number or `@tag`.
- **Add money:** by mobile money, card or bank transfer.
- **Payment requests:** ask someone for money. They can pay from any wallet, or decline.
- **Currency exchange:** convert between your own wallets.
- **Savings goals:** ring-fence money with a target and a date.
- **Scheduled payments:** weekly or monthly, with automatic retries.
- **Activity:** search and filter your history, with live status and shareable receipts.
- **Insights:** monthly totals, categories and top recipients.
- **Rate alerts:** get told when a currency reaches your target.
- **Referrals:** both people get a bonus after the new customer's first qualifying payment.
- **Security:** 6-digit PIN, weak-PIN rejection, lockout after 5 wrong tries, PIN confirmation for money movement,
  automatic app lock after 5 minutes away, and a list of signed-in devices you can sign out remotely.
- **Works on poor connections:** last-known balances are cached, and retrying a dropped payment can never pay twice.

### Staff console

- **Overview:** volume, fees, customer funds, queues and a live ledger check.
- **Transactions:** search, filter, CSV export, and the ledger entries behind each one.
- **Review queue:** approve or reject held transfers. Rejection refunds in full, including the fee.
- **Reversals:** undo a completed transfer exactly, if the recipient still has the money (owners only).
- **Customers:** balances, limits, freeze and restore, PIN unlock, tier changes and balance adjustments.
- **Identity verification:** approve or reject submissions. Approval raises limits.
- **Rates and fees:** edit exchange rates, margin, fees and tier limits (owners only).
- **Team and audit log:** owner and agent roles, with every sensitive action recorded.
- Light and dark themes.

---

## How the money works

All amounts are integers in minor units (cents). Floating-point numbers are never used for balances.

### Double-entry ledger

Every movement is a set of ledger entries that must net to zero in each currency. A posting that does not balance is
rejected, and a wallet can never go below zero: the code checks it, and a database constraint backs it up.

| Account | Holds |
|---|---|
| `wallet` | A customer's spendable balance |
| `pot` | Money set aside in a savings goal |
| `clearing` | Funds in flight: under review or with a payout partner |
| `fees` | Fee income |
| `fx` | The platform's position in each currency after conversions |
| `external` | Money at payment partners |
| `promo`, `adjustment` | Referral bonuses and staff corrections |

### The life of a transfer

```
quote ──► confirm with PIN ──► money held in clearing
                                     │
             ┌───────────────────────┼─────────────────────┐
     under safety threshold     large or unusual       bank or mobile money
             │                       │                     │
        MyMoney user            status: review         status: pending
        paid instantly     staff approve or reject    partner confirms by webhook
             │                       │                     │
         completed       completed / failed + refund   completed / failed + refund
```

### Safeguards

| Risk | Protection |
|---|---|
| Double taps, flaky networks | Each attempt has an idempotency key. Replays return the original transaction. |
| Two payments racing for one balance | Each payment runs in a single serialized database transaction. |
| Rate changes mid-payment | Quotes lock the price, expire, belong to one user and can be used once. |
| Forged partner callbacks | Webhooks need an HMAC-SHA256 signature, and amounts are checked. |
| Fraud | Per-transfer, daily and monthly limits by tier. Large or rapid transfers wait for review. |
| PIN guessing | Lockout, rate limiting, and identical errors for known and unknown phone numbers. |
| Malicious data in exports | CSV cells that look like formulas are neutralised. |
| Silent corruption | A health check confirms that every balance equals the sum of its entries. |

---

## Getting started

You need Node.js 22 or newer.

### 1. API

```bash
cd api
cp .env.example .env
npm install
npm run db:seed
npm run dev
```

Before seeding, set `DEMO_PHONE` and a 6-digit `DEMO_PIN` in `api/.env`. The API runs at `http://localhost:4100`. The seed creates these logins, plus three other customers to pay:

| Who | Login | Secret |
|---|---|---|
| Customer (ZAR, verified) | `YOUR_PHONE_NUMBER` | PIN `YOUR_PIN` |
| Console owner | `YOUR_OWNER_EMAIL@fakeemail.com` | `YOUR_PASSWORD` |

These are for local development only. The seed refuses to run in production.

### 2. Console

```bash
cd console
cp .env.example .env.local
npm install
npm run dev
```

Open `http://localhost:3100`.

### 3. Mobile app

```bash
cd mobile
npm install
npx expo run:ios
```

Use `npx expo run:android` for Android. The app finds the API on your development machine automatically. To point it
somewhere else, set `EXPO_PUBLIC_API_URL`.

### Trying the sandbox

- Top-ups and payouts settle by themselves within a few seconds.
- A payout to an account ending in `0000` fails, so you can see the automatic refund.
- A transfer worth $3,000 or more goes to the review queue, as does a sixth transfer within ten minutes.

### Tests

```bash
cd api
npm test
```

The 80 tests include concurrent overspending, replayed requests, forged webhooks, reversals and permission checks.

---

## Configuration (API)

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `4100` | HTTP port |
| `DATABASE_PATH` | `./data/mymoney.db` | SQLite file location |
| `JWT_SECRET` | none | Signing key. Required in production, 32+ characters. |
| `CORS_ORIGINS` | `http://localhost:3100` | Browser origins allowed to call the API |
| `PROVIDER_MODE` | `sandbox` | `sandbox` settles automatically. `live` waits for webhooks. |
| `SANDBOX_SETTLE_SECONDS` | `4` | Sandbox settlement delay |
| `PROVIDER_WEBHOOK_SECRET` | none | Webhook signing key. Required in production, 32+ characters. |

## Deploying

```bash
cp .env.example .env
docker compose up -d --build
docker compose exec api node dist/scripts/createOwner.js YOUR_EMAIL@fakeemail.com 'YOUR_PASSWORD' "YOUR_NAME"
```

Put the API and console behind HTTPS. Back up the `api-data` volume, because it holds the database.

SQLite suits a single API instance and keeps the ledger simple. To run several instances, move to a server database and
replace the serialized transactions with row-level locks on the accounts involved.

## Integrating a real payment partner

1. Set `PROVIDER_MODE=live`.
2. When a top-up or payout is created, send it to your partner using its `provider_ref`.
3. Have the partner call `POST /v1/webhooks/provider` with
   `{ "providerRef", "status": "success" | "failed", "amount", "reason" }`, signing the raw body in the `X-Signature`
   header with HMAC-SHA256 and `PROVIDER_WEBHOOK_SECRET`.

## Roadmap

- Adapters for real card, bank and mobile money partners
- Document photo upload and automated identity checks
- Push notifications
- Sanctions screening
- Biometric unlock

See [docs/API.md](docs/API.md) for the full API reference.

## License

MIT. See [LICENSE](LICENSE).
