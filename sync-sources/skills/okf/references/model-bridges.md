# Model Bridge Ladder

`--model <model>` is a hard routing request for `/okf study`, `/okf retro`, `/okf sync`, and `/okf author`. Never silently substitute a different model, vendor, or provider.

## Ladder

1. Use the current harness natively when it can serve the requested model.
2. Use a vendor CLI already on `PATH`.
3. Use an installed bridge plugin command.
4. Use an available MCP bridge tool.
5. If none can serve the model, stop with the error template below.

## Vendor CLI Bridges

### Codex

Before using Codex, run:

```bash
codex login status
```

If authenticated, write the model prompt to a local file when it is large, then invoke:

```bash
codex exec -m <model> --sandbox workspace-write --output-last-message <output-file> "<prompt>"
```

The `--sandbox workspace-write` flag preserves the skill's portable write boundary. The `--output-last-message <output-file>` flag gives the caller a deterministic file to read back into the OKF workflow.

### Gemini

Before using Gemini, verify either Application Default Credentials or `GOOGLE_API_KEY` is configured:

```bash
gcloud auth application-default print-access-token
```

or:

```bash
test -n "$GOOGLE_API_KEY"
```

If authenticated, invoke:

```bash
gemini -p "<prompt>" -m <model>
```

## Bridge Plugins

If a local bridge plugin is installed, prefer its explicit command for the vendor:

- `/codex:rescue` for Codex-served models.
- `/gemini:task` for Gemini-served models.

Use the bridge's documented prompt handoff format. Do not translate a requested model to a different vendor.

## MCP Bridge Tools

If MCP bridge tools are available, use the vendor-matching tool family:

- `mcp__codex__*` for Codex-served models.
- `mcp__gemini__*` for Gemini-served models.
- `ai-cli-mcp` only when it explicitly supports the requested vendor and model.

## Hard Error Template

When no bridge can serve the requested model, emit this template verbatim with the bracketed values filled:

```text
ERROR: Requested model [model] cannot be served by this OKF skill session.
Bridge: [bridge-name]
Install: [install-command]
Auth: [auth-step]
No fallback model was used.
```

The four fields are mandatory: the requested model, the bridge that would serve it, the install command, and the auth step.

## Overdeck

Under Overdeck, `pan knowledge --model <model>` bypasses this portable ladder. Overdeck owns provider-default harness routing, so the OKF skill must pass the requested model through and let Overdeck resolve or reject it.
