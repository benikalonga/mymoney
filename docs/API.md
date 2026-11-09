# MyMoney API reference

Base path: `/v1`. Bodies are JSON. Amounts are integers in minor units (`1250` means 12.50).

Authenticated routes need `Authorization: Bearer <token>`. Errors look like:

```json
{ "error": { "code": "INSUFFICIENT_FUNDS", "message": "Not enough USD available for this" } }
```

Payment routes take an `idempotencyKey` (8 to 100 characters). Sending the same key again returns the original result.

## Public

| Method | Path | Purpose |
|---|---|---|
| GET | `/meta` | Currencies, categories, providers and fees |
| GET | `/rates?base=USD` | Customer exchange rates |
| POST | `/webhooks/provider` | Signed partner callback (`X-Signature`) |

## Accounts

| Method | Path | Body or notes |
|---|---|---|
| POST | `/auth/register` | `phone, pin, firstName, lastName, currency?, referralCode?, device?` |
| POST | `/auth/login` | `phone, pin, device?` |
| POST | `/auth/logout` | Ends this session |
| POST | `/auth/verify-pin` | `pin` |
| POST | `/auth/pin` | `currentPin, newPin`. Signs out other devices. |
| GET, PATCH | `/me` | `firstName, lastName, email, tag, defaultCurrency` |
| GET | `/me/limits` | Tier limits and usage |
| GET | `/sessions` | Signed-in devices |
| DELETE | `/sessions/:id` | Signs out a device |

## Money

| Method | Path | Body or notes |
|---|---|---|
| GET, POST | `/wallets` | List, or open with `currency` |
| GET | `/users/lookup?q=` | Find a customer by phone or tag |
| POST | `/quotes` | `sendCurrency`, `sendAmount` or `receiveAmount`, and `recipientId` or (`method`, `receiveCurrency`) |
| POST | `/transfers` | `quoteId, pin, idempotencyKey, note?, category?` |
| POST | `/exchange` | `quoteId, pin, idempotencyKey` |
| POST | `/topups` | `currency, amount, provider, idempotencyKey` |
| GET | `/transactions` | `q, type, status, currency, direction, page, limit` |
| GET | `/transactions/:id` | One transaction |

Transaction statuses: `processing`, `review`, `pending`, `completed`, `failed`, `reversed`.

## Everyday features

| Method | Path | Body or notes |
|---|---|---|
| GET, POST | `/recipients` | `method, account, currency, name?, provider?` |
| PATCH, DELETE | `/recipients/:id` | `name?, favorite?` |
| GET, POST | `/requests` | `?box=incoming\|outgoing`, or `payer, currency, amount, note?` |
| POST | `/requests/:id/pay` | `pin, idempotencyKey, fromCurrency?` |
| POST | `/requests/:id/decline`, `/cancel` | |
| GET, POST | `/pots` | `name, target, currency, targetDate?` |
| POST | `/pots/:id/deposit`, `/withdraw` | `amount, idempotencyKey` |
| DELETE | `/pots/:id` | Closes the goal and returns its balance |
| GET, POST | `/schedules` | `recipientId, currency, amount, frequency, startDate, note?, pin` |
| PATCH, DELETE | `/schedules/:id` | `status: active\|paused` |
| GET, POST | `/rate-alerts` | `from, to, target, direction` |
| DELETE | `/rate-alerts/:id` | |
| GET | `/notifications` | Latest 100 and the unread count |
| POST | `/notifications/read` | Marks all as read |
| GET | `/insights?month=YYYY-MM` | Totals, categories, top recipients and trend |
| GET, POST | `/kyc` | `legalName, dateOfBirth, documentType, documentNumber, address` |

## Console (staff tokens)

`POST /admin/auth/login` takes `email, password`. The rest need a staff token. Routes marked (owner) need the owner role.

| Method | Path | Purpose |
|---|---|---|
| GET | `/admin/me`, `/admin/overview` | Current staff member, dashboard |
| GET | `/admin/transactions` | `q, status, type, userId, page, limit, format=csv` |
| GET | `/admin/transactions/:id` | Details and ledger entries |
| POST | `/admin/transactions/:id/approve` | Release a held transfer |
| POST | `/admin/transactions/:id/reject` | `reason`. Refunds the customer. |
| POST | `/admin/transactions/:id/reverse` | `reason` (owner) |
| GET | `/admin/users`, `/admin/users/:id` | Search, details |
| PATCH | `/admin/users/:id` | `status?, tier? (owner), reason` |
| POST | `/admin/users/:id/unlock` | Clears a PIN lock |
| POST | `/admin/users/:id/adjust` | `currency, amount, reason` (owner) |
| GET | `/admin/kyc?status=` | Verification queue |
| POST | `/admin/kyc/:id` | `decision, reason?` |
| GET | `/admin/pricing` | Rates, margin, fees and limits |
| PATCH | `/admin/pricing/rates/:currency`, `/spread`, `/fees/:method`, `/limits/:tier` | (owner) |
| GET, POST | `/admin/team` | (owner) |
| PATCH | `/admin/team/:id` | `active` (owner) |
| GET | `/admin/audit` | Audit log |
| GET | `/admin/ledger/health` | Ledger integrity check |
