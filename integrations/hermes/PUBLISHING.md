# Publishing

Publishing is a separate step the operator approves (PAN-4927 D-5).

## Build

```bash
python -m pip install build
python -m build integrations/hermes
```

Check that the wheel carries the bundled skill:

```bash
unzip -l integrations/hermes/dist/overdeck_hermes-0.1.0-py3-none-any.whl | grep overdeck_hermes/skills/overdeck/SKILL.md
```

The PyPI name is `overdeck-hermes`. Run the live checks in
[`docs/verification.md`](docs/verification.md) first.

## Upload

Only after the operator approves the release:

```bash
python -m pip install twine
twine upload integrations/hermes/dist/*
```

## After the release

Record the version, the tested Hermes version and the release commit in
[`CHANGELOG.md`](CHANGELOG.md).
