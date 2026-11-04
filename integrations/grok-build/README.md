# Overdeck for Grok Build

This plugin gives Grok Build the `overdeck` MCP tools and the `overdeck`
skill, so it can see and steer your Overdeck coding agents: read
conversations, see prompts that wait for you, and, with the access you
grant, send messages and answer prompts through `/overdeck status|pending|answer`.

## Status

Version 0.1.0. Not published to any marketplace. What was checked before
this release is recorded in [`docs/verification.md`](docs/verification.md).

## Install

```bash
grok plugin install eltmon/overdeck#integrations/grok-build --trust
grok plugin enable overdeck
```

Installing from a local checkout instead:

```bash
grok plugin install ./integrations/grok-build --trust
```

`grok plugin install` **copies** the folder into
`~/.grok/installed-plugins/`. To pick up a change, uninstall and install
again:

```bash
grok plugin uninstall overdeck --confirm
```

Confirm the install with:

```bash
grok plugin details overdeck
grok inspect
```

## How it reaches Overdeck

`.mcp.json` runs `scripts/run-mcp.sh` as the `overdeck` MCP server:

```json
{
  "mcpServers": {
    "overdeck": {
      "command": "${GROK_PLUGIN_ROOT}/scripts/run-mcp.sh",
      "env": {}
    }
  }
}
```

The script serves MCP on stdio by exec'ing, in order:

1. The paired Overdeck connector, when `pairing.json` exists in the
   connector home (`~/.overdeck-connector` by default, or
   `OVERDECK_CONNECTOR_HOME`): a `pan` on `PATH` that has `mcp connector`,
   else `npx -y @overdeck/core@0.74.0 mcp connector serve --stdio`. Set
   `OVERDECK_CORE_VERSION` to match the version the Connect a bot dialog
   showed you, if it differs from the pin above.
2. Otherwise, `pan mcp serve` when `pan` is on `PATH`.
3. Otherwise, it prints an install hint to stderr and exits 1.

## This computer (default)

Overdeck and Grok Build run on the same computer. Create a token in
Settings → Anywhere → Bots → Connect a bot (Grok Build, This computer), then
paste the "Token setup" lines it shows, which look like this:

```bash
umask 077 && printf '%s' '<token>' > "$HOME/.overdeck/grok-build-mcp-token"
export OVERDECK_MCP_TOKEN_FILE="$HOME/.overdeck/grok-build-mcp-token"
```

The script finds `$HOME/.overdeck/grok-build-mcp-token` on its own once it
exists, so the `export` line is only needed if you used a different path.

## Overdeck connector

Grok Build runs on a computer without Overdeck installed. Connect a bot
(Grok Build, Overdeck connector) shows a pairing string; run the commands it
gives you, which look like this:

```bash
npx -y @overdeck/core@<version> mcp connector login
npx -y @overdeck/core@<version> mcp connector pair '<pairing string>'
```

There is no `serve` step here: the plugin starts
`mcp connector serve --stdio` itself. This needs Node 22.16 or later.
Through a connector, `list_machines` is hidden and the tools reach only the
one paired machine.

## Tailscale

Not yet working for Grok Build — see
[eltmon/overdeck#5029](https://github.com/eltmon/overdeck/issues/5029). Use
the Overdeck connector instead.

## Using it

- `/overdeck status` — machines and conversations you can reach.
- `/overdeck pending` — a numbered list of prompts waiting for you, or that
  nothing waits.
- `/overdeck answer <n> <choice>` — answers item `<n>` of the last `pending`
  list with `<choice>`.

On a computer with Overdeck installed, `pan sync` also installs Overdeck's
own `overdeck` skill (the `pan` alias), so Grok reports the name as
ambiguous. Type `/overdeck:overdeck pending` for this plugin;
`/user:overdeck` is the `pan` alias.

Grok Build discards prompt-hook output, so this plugin has no summary hook.

## Access

The bot sees only the tools its token's scopes allow. `answer` needs
`approve`. Defaults: `read:state`, `read:conversations`, `tell`.

## Troubleshooting

- **"Install Overdeck (npm i -g @overdeck/core) or pair a connector"** —
  neither the connector branch nor `pan mcp serve` could run; install
  Overdeck or pair a connector.
- **"OVERDECK_MCP_TOKEN … is not set"** — no token file; redo the "This
  computer" setup above.
- **"the token is unknown or revoked"** — create a new token.
- Grok started from a desktop launcher may not inherit the shell `PATH`
  entries for `pan`/`npx` (for example, from `nvm`). Start `grok` from a
  shell instead.

## License

MIT, see [LICENSE](LICENSE).
