# Wallet Events Assessment

A small NestJS and TypeScript API that processes incoming deposit events, maintains wallet transaction history and prevents duplicate credits.

## Technology

- Node.js
- TypeScript
- NestJS
- Prisma ORM
- SQLite
- Vitest
- Supertest

SQLite was selected to keep the assessment self-contained and easy to run locally. It is sufficient for demonstrating persistence, idempotency and the required state transitions, but it does not provide the same production concurrency and locking model I would use with PostgreSQL.

## Requirements implemented

The application seeds:

- Wallet ID: `W001`
- Customer ID: `C001`
- Currency: `NGN`
- Opening balance: `0` kobo

Endpoints:

- `POST /provider/events`
- `GET /wallets/W001`

Supported transaction statuses:

- `pending`
- `successful`
- `failed`

Rules implemented:

- Pending deposits appear in history but do not affect available balance.
- A successful deposit credits the wallet once.
- Failed deposits do not affect available balance.
- Successful and failed states are terminal.
- Repeated `eventId` values have no additional effect.
- Multiple event IDs for the same `transactionRef` do not create duplicate credits.
- Reused event IDs or transaction references with conflicting wallet, amount or currency are rejected.
- Negative or zero amounts are rejected.
- Unsupported currencies are rejected.
- Unknown wallets are rejected.
- Accepted state changes and no-op terminal events are recorded in `ProviderEvent`.

## Installation

Install dependencies:

```bash
npm install
```

Create the database:

```bash
npx prisma migrate dev
```

Generate the Prisma client:

```bash
npx prisma generate
```

Seed the wallet:

```bash
npx tsx prisma/seed.ts
```

Start the application:

```bash
npm run start:dev
```

The API runs on:

```text
http://localhost:3000
```

## API examples

### Create a pending deposit

```bash
curl -X POST http://localhost:3000/provider/events \
  -H "Content-Type: application/json" \
  -d '{
    "eventId":"E001",
    "transactionRef":"T001",
    "walletId":"W001",
    "amountKobo":250000,
    "currency":"NGN",
    "status":"pending"
  }'
```

Expected result:

```json
{
  "accepted": true,
  "duplicate": false,
  "result": "RECORDED_PENDING",
  "transactionStatus": "pending"
}
```

The wallet balance remains `0` because pending deposits are not available funds.

### Mark the deposit successful

```bash
curl -X POST http://localhost:3000/provider/events \
  -H "Content-Type: application/json" \
  -d '{
    "eventId":"E002",
    "transactionRef":"T001",
    "walletId":"W001",
    "amountKobo":250000,
    "currency":"NGN",
    "status":"successful"
  }'
```

Expected result:

```json
{
  "accepted": true,
  "duplicate": false,
  "result": "CREDITED",
  "transactionStatus": "successful"
}
```

The wallet balance becomes `250000` kobo.

### Read wallet state

```bash
curl http://localhost:3000/wallets/W001
```

Example response:

```json
{
  "walletId": "W001",
  "customerId": "C001",
  "currency": "NGN",
  "availableBalanceKobo": 250000,
  "transactions": [
    {
      "reference": "T001",
      "amountKobo": 250000,
      "currency": "NGN",
      "status": "successful"
    }
  ]
}
```

## Required scenario behaviour

### Pending followed by successful

A pending `T001` for `250000` kobo appears in transaction history but does not change the available balance.

When a later event marks `T001` as successful, the transaction is updated and the balance increases once to `250000` kobo.

### Replaying the same successful event

If the exact same `eventId` is received again, the existing event result is returned and no financial state is changed.

The balance remains `250000` kobo.

### Different event ID for the same successful transaction

A different `eventId` for an already successful `transactionRef` is recorded for traceability but cannot credit the wallet again.

The transaction remains successful and the balance remains unchanged.

### Failed transaction

A failed deposit is recorded in transaction history but does not affect the available balance.

### Late pending event after success

Because `successful` is terminal for this exercise, a later pending event for the same transaction is recorded as an ignored terminal-state event.

It does not overwrite the successful status or alter the wallet balance.

### Invalid or conflicting data

Negative or zero amounts are rejected with `400 Bad Request`.

If an existing `eventId` or `transactionRef` is reused with a conflicting wallet, amount or currency, the request is rejected with `409 Conflict`.

## Testing

Run unit tests:

```bash
npm test -- --run
```

Run end-to-end tests:

```bash
npm run test:e2e
```

Build the project:

```bash
npm run build
```

At submission time, all automated checks passed successfully.

The end-to-end suite covers:

- pending followed by successful
- replaying the same successful event
- a different successful event ID for the same transaction
- failed transactions
- late pending events after success
- negative amounts
- conflicting transaction amounts
- unknown wallets
- unsupported currencies
- conflicting reused event IDs
- transactions whose first event is successful
- attempted success after a terminal failed state

## Design

### Transaction identity

`transactionRef` identifies the logical financial transaction.

`eventId` identifies an individual message received from the fictional provider.

Several provider events can therefore refer to one transaction without creating multiple transaction-history entries or multiple wallet credits.

For example:

```text
E001 -> T001 -> pending
E002 -> T001 -> successful
E003 -> T001 -> successful
```

There is still only one logical `T001` transaction.

### Transaction state

For this exercise, the supported transitions are:

```text
new -> pending
new -> successful
new -> failed

pending -> successful
pending -> failed
```

`successful` and `failed` are terminal.

Later events do not overwrite a terminal transaction or alter the balance.

A conflicting terminal event is still retained in the provider-event audit record so that contradictory provider messages remain traceable.

### Duplicate protection

The database has unique constraints for:

- `eventId`
- `transactionRef`

An identical replay of an existing event has no additional effect.

A different event for an already successful transaction cannot cause another credit.

The balance is only incremented when the logical transaction first enters the successful state.

### Audit trail

Provider events are stored separately from logical transactions.

This provides a trace of what the provider sent, including duplicate events, no-op events and events received after a transaction has already reached a terminal state.

Transaction history returned by the wallet endpoint represents logical financial transactions rather than every webhook message.

## Concurrency and production limitations

The solution uses SQLite because it keeps the assessment small and reproducible.

Prisma transactions are used to group related operations, such as:

- changing transaction state
- updating the wallet balance
- recording the provider event

This prevents those writes from being deliberately committed independently within one processing operation.

The current implementation also uses database uniqueness constraints for `eventId` and `transactionRef`.

However, I do not claim that the SQLite implementation provides production-grade protection against two application instances attempting the same pending-to-successful transition at exactly the same time.

With PostgreSQL, I would use:

- database transactions
- unique constraints
- row-level locking such as `SELECT ... FOR UPDATE`, or an equivalent atomic conditional update
- explicit transaction-state transition rules
- an append-only financial ledger or equivalent auditable balance-movement model

Only one concurrent request should be permitted to successfully transition a transaction into `successful`, and only that transition should produce the wallet credit.

## Database failure and recovery

Financial state and provider-event processing should not be treated as unrelated independent writes.

In this implementation, related changes are grouped in a Prisma transaction so that they commit together or roll back together.

In a production architecture with asynchronous processing, I would persist received events durably and use a processing state or transactional outbox pattern.

If processing failed part-way through, the event could then be retried safely through the same idempotent logic instead of manually changing the wallet balance.

## Real provider webhook authentication

A provider-supplied status such as `successful` would not be trusted on its own in a real bank integration.

I would verify:

- HTTPS transport
- provider cryptographic signature
- webhook timestamp or nonce
- replay protection
- provider transaction identifier
- expected internal transaction
- customer or wallet mapping
- exact amount
- exact currency
- destination account or virtual account where relevant

Where appropriate, I would also confirm the transaction directly through the provider's trusted API before changing internal financial state.

## Balance discrepancy investigation

If the displayed balance differed from transaction history, my first actions would be read-only.

I would inspect:

- wallet record
- transaction history
- provider-event records
- transaction state changes
- provider references
- timestamps
- application logs
- previous reconciliation information
- previous balance adjustments

I would preserve:

- original webhook payload
- webhook headers and signature information
- event IDs
- transaction references
- provider references
- timestamps
- application logs
- database audit information
- previous operator actions

I would not initially replay events, modify transaction status or directly change the wallet balance.

Before approving a correction, operations staff should be able to see:

- customer
- wallet
- current balance
- transaction amount
- currency
- internal reference
- provider reference
- internal status
- provider-reported status
- event timeline
- duplicate or conflicting events
- reconciliation status
- previous adjustments
- reason for the proposed correction
- approval trail

## Missing internal transaction reconciliation

If the provider reported a successful transaction that was missing internally, I would first search using:

- provider transaction reference
- internal transaction reference
- event ID
- customer
- wallet
- amount
- currency
- approximate transaction time

I would then inspect:

- webhook-ingress logs
- application errors
- retry or dead-letter queues
- database audit records
- previous reconciliation runs

I would query the provider through its trusted API and independently verify the transaction identity, customer or destination account, amount, currency and settlement state.

If the payment were genuine and internal processing had failed, I would pass it through the same controlled and idempotent transaction-processing path used for normal events.

I would not blindly replay a payment or directly overwrite the wallet balance.

## Assumptions

- The exercise processes incoming deposits only.
- NGN is the only accepted currency.
- `amountKobo` must be a positive integer.
- `successful` and `failed` are terminal states.
- `transactionRef` identifies a logical deposit.
- `eventId` identifies a provider event.
- Transaction history contains one record per logical transaction.
- Conflicting terminal events are retained for traceability but do not change financial state.
- Real provider authentication is outside the scope of the exercise.
- No frontend or deployment is required.

## Known limitations

- SQLite is used instead of PostgreSQL.
- There is no production authentication or authorisation.
- There is no real bank-provider integration.
- Provider signatures are not verified because the provider is fictional.
- There is no distributed locking or multi-instance concurrency guarantee.
- Wallet balance is stored directly rather than being derived from a full double-entry ledger.
- No operations dashboard is included because the exercise does not require a frontend.
- The implementation is intentionally small and focused on the assessment requirements.

## One improvement I would make next

The next improvement would be moving persistence to PostgreSQL and making the pending-to-successful transition explicitly concurrency-safe using row-level locking or an atomic conditional update.

I would also introduce an append-only ledger for balance movements so that wallet balances could be independently reconstructed and reconciled from financial entries rather than relying only on a stored balance field.

## Thought process

The detailed answers to the assessment's design and operational questions are in `THOUGHT_PROCESS.md`.

This covers:

- concurrent duplicate-credit protection
- database failure recovery
- webhook authenticity
- balance discrepancy investigation
- reconciliation of provider transactions missing internally

## Time spent

Approximately forty five minutes across implementation, testing and documentation.

## AI and documentation usage

I used AI assistance and technical documentation during the exercise, mainly for implementation guidance, reviewing edge cases and helping structure tests and documentation.

I personally ran and verified the API behaviour, manual requests, automated tests and production build. I also reviewed the submitted code and can explain the implementation, design choices, trade-offs and known limitations.
