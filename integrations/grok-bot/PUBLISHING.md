# Publishing

Publishing is a separate step the operator approves (PAN-4927 D-5).

## Before submission

- Add a square PNG logo at `assets/logo.png` and a `"logo": "assets/logo.png"`
  key in `.cursor-plugin/plugin.json`. This package ships without one (D-7).
- Cursor's publish form (https://cursor.com/marketplace/publish) takes a
  repository URL. This package is a subdirectory of `eltmon/overdeck`, so the
  operator either publishes it as its own repository (for example with
  `git subtree split --prefix integrations/grok-bot`) or asks the reviewer
  whether a subdirectory URL is accepted.
- State explicitly that the destination is Grok Bot's **Plugins catalog**.
  **Do not submit this package to the Grok Build marketplace** — its
  `.grok-plugin` index is a different product.
- Run the live checks in [`docs/verification.md`](docs/verification.md)
  first.

## After acceptance

Record the listing URL, the tested Grok Bot version, and the release commit
in [`CHANGELOG.md`](CHANGELOG.md).
