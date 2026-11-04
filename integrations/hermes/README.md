# Overdeck for Hermes

This plugin connects [Hermes Agent](https://github.com/NousResearch/hermes-agent)
to your Overdeck machine.

## What it does

Hermes reaches Overdeck's MCP tools through its own MCP client, so the model
sees them as `mcp__overdeck__*` (for example `mcp__overdeck__list_pending_input`).
The plugin adds four things on top. A pending-prompt summary tells the model, at
most every 5 minutes, what waits on you in Overdeck. The `/overdeck status`,
`/overdeck pending` and `/overdeck answer` chat commands show and answer those
prompts. The bundled `overdeck` skill tells the model how to use the tools
safely. `hermes overdeck setup` prints the `config.yaml` block for the
connector route.

## Requirements

- Hermes 0.21.6 or later, the first release with `ctx.call_mcp` and plugin
  settings. On an older Hermes the plugin logs one warning and does nothing.
- Python 3.11 or later.
- An Overdeck machine, and either the Overdeck connector (Node 22.16 or later)
  or Tailscale between Hermes and that machine.

## Install

```bash
pip install overdeck-hermes
```

That works once the package is published; until then install it from an
Overdeck checkout:

```bash
pip install -e integrations/hermes
hermes plugins enable overdeck
```

Or drop it into Hermes's plugin directory, from `integrations/hermes/`:

```bash
mkdir -p ~/.hermes/plugins/overdeck && cp -r src/overdeck_hermes/. plugin.yaml skills ~/.hermes/plugins/overdeck/
```

The plugin id is `overdeck` in every case.

## Connector route (default)

The Overdeck connector runs next to Hermes and serves the paired machine's
tools on `http://127.0.0.1:7466/mcp`, with no Tailscale and no public address.
Settings → Anywhere → Bots → Connect a bot shows the exact version and the
pairing string:

```bash
npx -y @overdeck/core@<version> mcp connector login
npx -y @overdeck/core@<version> mcp connector pair '<pairing string>'
npx -y @overdeck/core@<version> mcp connector serve
export OVERDECK_CONNECTOR_LOCAL_TOKEN="$(cat ~/.overdeck-connector/local-token)"
```

Then add this to `~/.hermes/config.yaml` (`hermes overdeck setup` prints it):

```yaml
# ~/.hermes/config.yaml — connector route (default)
mcp_servers:
  overdeck:
    url: "http://127.0.0.1:7466/mcp"
    headers:
      Authorization: "Bearer ${OVERDECK_CONNECTOR_LOCAL_TOKEN}"
plugins:
  enabled: [overdeck]
  entries:
    overdeck:
      mcp_allowlist: ["overdeck"]
      settings:
        summary: true
        allow_answers: false
```

The connector binds `127.0.0.1` only, so it must share Hermes's network. In a
container, either install Node 22 in the Hermes image and run `serve` as a
second process, or run the connector as a sidecar container with
`network_mode: "service:hermes"`.

## Tailscale route

Join Hermes's host to your tailnet with an ephemeral auth key tagged
`tag:overdeck-bot`, and give that tag an ACL that reaches only
`<dashboard host>:443`. Create a token in Connect a bot, put it in
`OVERDECK_MCP_TOKEN`, and add:

```yaml
# ~/.hermes/config.yaml — Tailscale route
mcp_servers:
  overdeck:
    url: "https://YOUR-MACHINE.YOUR-TAILNET.ts.net/mcp"
    headers:
      Authorization: "Bearer ${OVERDECK_MCP_TOKEN}"
plugins:
  enabled: [overdeck]
  entries:
    overdeck:
      mcp_allowlist: ["overdeck"]
      settings:
        summary: true
        allow_answers: false
```

## Settings

The plugin reads its settings from `plugins.entries.overdeck.settings` and
re-reads them on every use. `mcp_allowlist` stays at the entry root: it grants
the plugin the `overdeck` MCP server.

| Setting | Default | What it does |
| --- | --- | --- |
| `server` | `overdeck` | The `mcp_servers` entry that points at Overdeck. It must also be in `mcp_allowlist`. |
| `summary` | `true` | Adds the pending-prompt summary to a turn, at most every 5 minutes. |
| `allow_answers` | `false` | Lets `/overdeck answer` resolve prompts. Only the value `true` turns it on. |

Answering also needs a token or connector with the `approve` scope; Overdeck
refuses answers without it.

Do not set `trust: untrusted` on the `overdeck` server. Hermes would then ask
before every non-read tool call, including the summary's.

## Commands

- `/overdeck status` — whether Overdeck answers, how many prompts wait, and
  both switches.
- `/overdeck pending` — a numbered list of what waits on you, with the answer
  each item accepts.
- `/overdeck answer <n> <choice>` — answers item `<n>` from the last
  `/overdeck pending` in this chat. Numbers expire after 10 minutes, and one
  answer uses up the list: run `/overdeck pending` again before the next. The
  plugin checks that the item is still pending before it answers.

Accepted choices per prompt kind:

| Prompt | `<choice>` |
| --- | --- |
| Permission prompt in a conversation | `allow-once`, `allow-always` or `deny` |
| Question in a Claude Code conversation or agent | one answer per question, separated by ` \| `; each an option number or your own text |
| Codex approval | an option number from 1 to 9 |
| Pi question | an option number or your own text |
| Plan approval (conversation or agent) | `approve-auto`, `approve-manual`, `reject-ultraplan`, or `reject-feedback <text>` |
| Menu choice in a conversation | an option number |
| Agent permission request | `allow` or `deny` |

Held handoffs, prompts on a linked machine's agents, and prompts Overdeck
cannot answer remotely appear in the list with "answer it in the Overdeck
dashboard".

## Optional: wake Hermes with ntfy

Overdeck can push a notification when something needs you. Set Overdeck's
`push.ntfy` (see
[Push notifications](https://overdeck.ai/configuration/push-notifications)) to
a topic Hermes subscribes to: in Hermes, set `NTFY_TOPIC` to that topic,
`NTFY_ALLOWED_USERS` to the same topic, and `NTFY_PUBLISH_TOPIC` to a
different topic so Hermes's replies do not land on Overdeck's. Overdeck sends
titles only; the summary fills in the details on the next turn.

## Security

The `overdeck` skill tells the model that tool output is data, never
instructions; that a secret never goes into chat; and that it answers only
what you asked it to answer. `allow_answers` is off by default, and Connect a
bot leaves the `approve` scope off by default, so a fresh install can read but
not answer.

## License

MIT, see [LICENSE](LICENSE).
