# Thought Process

## Duplicate credits and concurrent requests

The current implementation protects normal sequential retries through two database uniqueness constraints: `eventId` is unique and `transactionRef` is unique. Replaying the same event therefore has no additional effect, while a new event for an already successful transaction does not credit the wallet again.

For this exercise I used SQLite. The application groups transaction state changes, provider-event recording and wallet balance updates inside Prisma transactions where appropriate. However, I do not claim that the current implementation provides production-grade protection against two requests reaching the pending-to-successful transition at exactly the same time across multiple application instances.

With PostgreSQL, I would process the transition inside a database transaction and lock the logical transaction or wallet row using row-level locking such as `SELECT ... FOR UPDATE`, or use an atomic conditional update. Database uniqueness constraints on `eventId` and `transactionRef` would remain important. The wallet would only be credited when the transaction successfully transitions into `successful`.

## Failure between recording an event and updating the wallet

Recording an event and changing the financial state should not be separate independently durable operations. In this implementation, related writes are grouped within a database transaction so they commit together or roll back together.

In a production design, I would retain this atomic database transaction. If webhook ingestion and financial processing were asynchronous, I would persist the incoming event first and use a durable processing state or transactional outbox. Failed processing could then be retried safely because the transaction logic is idempotent.

## Authenticating a real bank webhook

A provider status value such as `successful` would never be trusted by itself. I would verify the provider's cryptographic signature, validate timestamps or nonces to reduce replay risk, and require HTTPS.

I would then match the provider transaction identifier to an expected internal transaction and verify the customer or wallet, amount, currency and destination account. Where appropriate I would also confirm the transaction through the provider's trusted API before changing internal financial state.

## Balance and transaction-history mismatch

My first actions would be read-only. I would inspect the wallet record, transaction history, provider-event records, transaction state changes, timestamps, provider references, application logs and previous reconciliation information.

I would preserve the original webhook payload, headers or signature information, event IDs, provider references, timestamps, application logs and any existing audit trail. I would avoid replaying an event, changing transaction status or manually modifying a balance while investigating.

Before approving a correction, operations staff should be able to see the customer and wallet, current balance, transaction amount and currency, internal and provider references, internal status, provider-reported status, complete event timeline, duplicate or conflicting events, reconciliation state, previous adjustments and the proposed correction with its reason and approval trail.

## Provider reports success but the transaction is missing internally

I would search internal records using the provider reference, transaction reference, event ID, amount, customer and time window. I would inspect webhook-ingress logs, application errors, retry or dead-letter queues and database audit information.

I would then query the provider through its trusted API and independently verify the transaction identity, customer, wallet or destination account, amount, currency and settlement state.

If the payment is genuine and internal processing failed, I would pass it through the same controlled and idempotent transaction-processing path used for normal events. I would not blindly replay a payment or directly overwrite a customer's wallet balance.
