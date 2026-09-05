# Architecture Notes — Payments Service

Working notes from the March architecture review. Several decisions are still
open and need owners.

## Data store

We currently use Postgres for the ledger. TBD: do we shard by merchant ID or
by region? The sharding decision blocks the multi-region rollout and nobody
has been assigned to make the call.

## Event bus

Kafka vs SQS is still an open question. Kafka gives us replay but SQS is what
the platform team supports. Who decides this? Unclear — the platform team says
it is a product decision, product says it is a platform decision.

## Idempotency

TODO: we have not defined what the idempotency key format should be for the
new refunds endpoint. The old endpoint used UUIDv4 but there was a proposal to
switch to ULIDs — no conclusion was reached in the review.

## PCI scope

It remains unresolved whether the new tokenisation proxy takes the webhook
relay out of PCI scope. Awaiting a ruling from the compliance team (asked in
January, no response yet).
