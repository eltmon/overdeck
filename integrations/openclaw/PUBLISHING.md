# Publishing

Publishing is a separate step the operator approves (PAN-4927 D-5).

## Build and check

```bash
cd integrations/openclaw
npm ci && npm run build
npm test
npm pack --dry-run
```

`npm pack --dry-run` must list only `dist/`, `openclaw.plugin.json`,
`skills/`, `README.md`, `CHANGELOG.md`, `LICENSE` and `package.json`.

Run the live checks in [`docs/verification.md`](docs/verification.md) first.

## Publish

Publish to npm with `npm publish --access public`, or submit the package to
ClawHub.

## After release

Record the npm URL, the tested OpenClaw version and the release commit in
[`CHANGELOG.md`](CHANGELOG.md).
