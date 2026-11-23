# Publishing

Publishing is a separate step the operator approves (PAN-4927 D-5).

## Before submission

- `grok plugin validate integrations/grok-build` must print
  `Plugin manifest is valid.`.
- `npm view @overdeck/core@<pin> version` must print the pin in
  `scripts/run-mcp.sh`. `pan release` stamps that pin; if it names no
  published version yet, wait for the release to publish rather than editing
  it by hand.
- The live checks in [`docs/verification.md`](docs/verification.md) must
  pass.
- Tag the release: `grok plugin tag integrations/grok-build [--push]`.
- The destination is a Grok Build marketplace (a `.grok-plugin/marketplace.json`
  index, or a direct `owner/repo#subdir` install) — **not** Grok Bot's
  Plugins catalog. That is `integrations/grok-bot/`, a different product.

## After acceptance

Record the listing URL, the tested Grok Build version, and the release
commit in [`CHANGELOG.md`](CHANGELOG.md).
