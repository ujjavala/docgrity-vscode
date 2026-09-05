# Deployment Guide

This document explains how to deploy the payments service to production.

## Prerequisites

- Node.js 22 installed locally
- Access to the `prod-deployers` GitHub team
- The `PAYMENTS_DEPLOY_KEY` secret configured in your environment

## Steps

1. Create a release branch from `main` named `release/vX.Y.Z`.
2. Run the full test suite: `npm test -- --coverage`.
3. Bump the version in `package.json` and update `CHANGELOG.md`.
4. Tag the release: `git tag vX.Y.Z && git push --tags`.
5. Trigger the deploy workflow from the Actions tab, selecting the tag.
6. Watch the canary rollout in Grafana for 15 minutes before promoting to 100%.

## Rollback

If error rates exceed 1% during canary, run the `rollback` workflow with the
previous tag. Rollbacks complete in under 5 minutes.
