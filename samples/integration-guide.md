# Partner Integration Guide

A quick-start guide for partners integrating with the public payments API.

## Getting started

Request an API key from the developer portal. Every API key allows
**1000 requests per minute**, and the rate limiter supports short bursts of
up to 2000 requests thanks to a sliding-window algorithm with burst credit.

## Authentication

Authenticate every request by sending your key as a Bearer token in the
`Authorization` header: `Authorization: Bearer <api-key>`. This is the only
supported authentication method for the public payments API.

## Webhooks

Webhook deliveries are retried up to 10 times over 24 hours. Endpoints are
never disabled automatically — failed deliveries simply expire after the
final retry.
