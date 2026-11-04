# Overdeck for OpenClaw

This plugin connects an OpenClaw gateway to Overdeck. Your OpenClaw agents can
see your Overdeck conversations and agents, tell you what waits for you, and,
when you allow it, answer Overdeck prompts with the choice you give them in
chat. The Overdeck tools reach OpenClaw through OpenClaw's own MCP client; the
plugin adds a needs-you summary, two chat tools and the `overdeck` skill.

**Status:** version 0.1.0. It is not published to npm or listed in any
catalog. The checks against OpenClaw are recorded in
[`docs/verification.md`](docs/verification.md).

## What it includes

- `openclaw.plugin.json`, the plugin manifest (plugin id `overdeck`).
- The plugin entry (`dist/index.js`, built from `src/`). It registers two
  chat tools, `overdeck_pending` and `overdeck_answer`, and a
  `before_prompt_build` hook that adds the needs-you summary.
- The shared `overdeck` skill in `skills/overdeck/SKILL.md`. It is a copy of
  `integrations/shared/SKILL.md`; edit only the shared file.

## Requirements

- OpenClaw 2026.5.6 or later (checked with 2026.10.10).
- An Overdeck machine, and either the Overdeck connector (Node 22.16 or
  later) or Tailscale.

## Install

From a checkout of this repository:

```bash
cd integrations/openclaw && npm ci && npm run build
openclaw plugins install ./integrations/openclaw
```

Or pack it first and install the tarball:

```bash
cd integrations/openclaw && npm ci && npm run build && npm pack
openclaw plugins install npm-pack:./overdeck-openclaw-0.1.0.tgz
```

OpenClaw warns that a local path is outside ClawHub review and asks for
capability consent. Review the package, then confirm. Without a terminal to
confirm in, pass `--force --accept-capabilities`.

The plugin has no runtime dependencies and does not need the `openclaw`
package installed next to it.

## Connector route (default)

The Overdeck connector runs next to OpenClaw and serves the paired machine's
tools on `http://127.0.0.1:7466/mcp`, with no Tailscale and no public address.
Settings → Anywhere → Bots → Connect a bot shows the exact version and the
pairing string:

```bash
npx -y @overdeck/core@<version> mcp connector login
npx -y @overdeck/core@<version> mcp connector pair '<pairing string>'
npx -y @overdeck/core@<version> mcp connector serve
export OVERDECK_CONNECTOR_LOCAL_TOKEN="$(cat "${OVERDECK_CONNECTOR_HOME:-$HOME/.overdeck-connector}/local-token")"
```

Then add this to your OpenClaw config:

```json5
// openclaw config
mcp: { servers: { overdeck: {
  url: "http://127.0.0.1:7466/mcp",
  transport: "streamable-http",   // the default is "sse", which Overdeck does not serve
  headers: { Authorization: "Bearer ${OVERDECK_CONNECTOR_LOCAL_TOKEN}" },
} } },
plugins: { entries: { overdeck: { config: { localToken: "${OVERDECK_CONNECTOR_LOCAL_TOKEN}" } } } },
```

### Running the connector next to OpenClaw

The connector binds `127.0.0.1` only, so it must share OpenClaw's network
namespace. In a container, either install Node 22 in the OpenClaw image and
run `serve` as a second process, or run the connector as a sidecar container
with `network_mode: "service:openclaw"` in Docker Compose. On Fly, install
Node 22 in the image and run the connector as a second process.

## Tailscale route

Join OpenClaw's container to your tailnet with an ephemeral auth key tagged
`tag:overdeck-bot`, and give that tag an ACL that reaches only
`<dashboard host>:443`. Create a token in Connect a bot, put it in
`OVERDECK_MCP_TOKEN`, and add:

```json5
// openclaw config
mcp: { servers: { overdeck: {
  url: "https://YOUR-MACHINE.YOUR-TAILNET.ts.net/mcp",
  transport: "streamable-http",   // the default is "sse", which Overdeck does not serve
  headers: { Authorization: "Bearer ${OVERDECK_MCP_TOKEN}" },
} } },
plugins: { entries: { overdeck: { config: { connectorUrl: "https://YOUR-MACHINE.YOUR-TAILNET.ts.net/mcp", localToken: "${OVERDECK_MCP_TOKEN}" } } } },
```

## Turn on the summary

OpenClaw 2026.10.10 blocks the `before_prompt_build` hook for plugins it does
not bundle until you grant it. Without the grant the chat tools work, but no
summary is added. Add `hooks: { allowConversationAccess: true }` next to
`config` in the same entry:

```json5
plugins: { entries: { overdeck: {
  hooks: { allowConversationAccess: true },
  config: { localToken: "${OVERDECK_CONNECTOR_LOCAL_TOKEN}" },
} } },
```

The grant lets the hook read the conversation. This plugin's hook ignores the
conversation; it only asks Overdeck what waits for you. On the Tailscale route,
keep your `connectorUrl` and `localToken` lines and add the same `hooks` line.

## What the plugin adds

- **The Overdeck tools.** They come from `mcp.servers.overdeck`, so agents
  see them as `overdeck__<tool>`, for example `overdeck__list_conversations`.
- **The needs-you summary.** Before an agent turn, the plugin asks Overdeck
  what waits for you, at most once every 5 minutes per gateway. It adds a
  short list to the turn only when something waits, labeled as data from
  Overdeck, not instructions. It needs the hook grant in
  [Turn on the summary](#turn-on-the-summary).
- **Privacy note.** The summary goes into every agent turn of the gateway,
  including turns in shared channels and group chats. Set `summary: false` on
  a gateway that serves group chats.
- **`overdeck_pending`.** A numbered list of what waits for you. Each item
  shows its number, an 8-character ref, where it is, what kind of prompt it
  is, and the choices it accepts.
- **`overdeck_answer`.** Answers one item with `item`, `ref` and `choice`.
  It is off until you set `allowAnswers: true`, and Overdeck also refuses
  answers unless the connector or token has `approve` access. Before it
  answers, it lists again and refuses when the item at that number no longer
  has the same ref. Prompts with more than one question go through
  `overdeck__answer_question` or the Overdeck dashboard.

## Config reference

The plugin reads `plugins.entries.overdeck.config`.

| Key | Default | What it does |
| --- | --- | --- |
| `connectorUrl` | `http://127.0.0.1:7466/mcp` | The Overdeck MCP URL: the connector, or the dashboard over Tailscale. |
| `localToken` | none | The connector local token, or an Overdeck access token on the Tailscale route. Use a `${VAR}` reference. |
| `summary` | `true` | Adds the needs-you summary to agent turns, at most every 5 minutes. |
| `allowAnswers` | `false` | Lets `overdeck_answer` answer Overdeck prompts. Only the value `true` turns it on. |

## Security

- `connectorUrl` must use `https://`, or `http://` on exactly `127.0.0.1`,
  `localhost` or `[::1]`, and must not contain a user name or password. The
  plugin refuses any other URL.
- The token is never a tool argument, never logged and never part of a tool
  answer or an error text.
- Everything the plugin shows from Overdeck is data, not instructions. Each
  item is collapsed to one line, so a prompt cannot add lines of its own.
- Answers send only named fields to Overdeck; nothing the model passes is
  copied into the request.

## Troubleshooting

- `openclaw mcp probe overdeck` connects and lists the Overdeck tools.
- No Overdeck tools: check `transport: "streamable-http"`. The `minimal` tool
  profile and `tools.deny: ["bundle-mcp"]` also hide MCP tools.
- No summary: check `hooks: { allowConversationAccess: true }` under
  `plugins.entries.overdeck`. `openclaw plugins inspect overdeck --runtime`
  lists `before_prompt_build` under typed hooks once the grant is in place.
- `openclaw mcp doctor` warns about a literal token in `headers`. Keep the
  `${VAR}` reference.
- `Overdeck is not set up: …` from a tool names the config problem, for
  example a refused `connectorUrl` or a missing `localToken`.

## License

MIT. See [`LICENSE`](LICENSE).
