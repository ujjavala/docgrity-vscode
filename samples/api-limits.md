# API Rate Limits

Rate limiting policy for the public payments API.

## Limits

Every API key is limited to **100 requests per minute**. Requests beyond the
limit receive HTTP `429 Too Many Requests` with a `Retry-After` header.

Burst traffic is not tolerated: the limiter uses a fixed one-minute window
with no burst allowance.

## Authentication

All API requests must authenticate with the `X-Api-Key` header. Bearer tokens
are **not supported** on the public API — they are reserved for internal
service-to-service calls.

## Webhooks

Webhook deliveries are retried up to 3 times with exponential backoff. After
the third failure the webhook endpoint is disabled and the account owner is
emailed.
