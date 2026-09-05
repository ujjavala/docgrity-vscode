# Release Process

How to release the payments service to production.

## Before you start

- Node.js 22 installed locally
- Membership of the `prod-deployers` GitHub team
- The `PAYMENTS_DEPLOY_KEY` secret configured in your environment

## Process

1. Create a release branch from `main` named `release/vX.Y.Z`.
2. Run the full test suite with coverage: `npm test -- --coverage`.
3. Bump the version in `package.json` and update `CHANGELOG.md`.
4. Tag the release: `git tag vX.Y.Z && git push --tags`.
5. Trigger the deploy workflow from the GitHub Actions tab, selecting the tag.
6. Watch the canary rollout in Grafana for 15 minutes before promoting to 100%.

## Rolling back

If error rates exceed 1% during the canary phase, run the `rollback` workflow
with the previous tag. A rollback completes in under 5 minutes.
