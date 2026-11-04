# Publishing

Publishing is a separate step the operator approves (PAN-4927 D-5).

## Before submission

- `grok plugin validate integrations/grok-build` must print
  `Plugin manifest is valid.`.
- `npm view @overdeck/core@<pin> version` must print the pin. If it does
  not — the pin in `scripts/run-mcp.sh` named no published version yet —
  bump `OVERDECK_CORE_VERSION` in `scripts/run-mcp.sh`, in `README.md`, and
  in `CHANGELOG.md` together.
- The live checks in [`docs/verification.md`](docs/verification.md) must
  pass.
- Tag the release: `grok plugin tag integrations/grok-build [--push]`.
- The destination is a Grok Build marketplace (a `.grok-plugin/marketplace.json`
  index, or a direct `owner/repo#subdir` install) — **not** Grok Bot's
  Plugins catalog. That is `integrations/grok-bot/`, a different product.

## After acceptance

Record the listing URL, the tested Grok Build version, and the release
commit in [`CHANGELOG.md`](CHANGELOG.md).
