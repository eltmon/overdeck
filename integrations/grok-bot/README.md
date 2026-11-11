# Overdeck for Grok Bot and the xAI API

This package lets Grok Bot reach your Overdeck machine through the Overdeck
connector, and lets Grok Bot and the xAI Responses API reach it through the
opt-in public MCP server: read conversations, see prompts that wait for you,
and, with the access you grant, send messages and answer prompts.

## Connect in one paste

In Overdeck, open Settings → Anywhere → Bots → Connect a bot, pick Grok Bot
and its access, and click **Copy for Grok Bot**. Paste the copied message
into Grok Bot's chat. It looks like this, with your machine, version and a
one-time pairing string filled in:

```text
Please connect yourself to my Overdeck machine "<machine>" as "Grok Bot".

Run this command in your shell. You can run it again at any time; each run continues where the last one stopped:

npx -y @overdeck/core@<version> mcp connector connect '<pairing string>' --name 'Grok Bot' --platform grok-bot

Then act on the last line it prints. That line starts with OVERDECK_CONNECT and holds JSON:
- If "status" is "authorize", show me the "url" link. I will open it and click Authorize. When I tell you I did, run the same command again.
- If "status" is "retry", do what "next" says, then run the same command again.
- If "status" is "error", tell me the "code" and do what "next" says.
- If "status" is "ready", register exactly the MCP server in "registration", call list_conversations once, and tell me the result.

The pairing code in the command works once and expires soon. Do not save it anywhere. If it is refused, ask me to copy a new message from Overdeck.
```

Grok Bot runs the command and shows you one link. Open it, click
**Authorize**, and tell Grok Bot you did. It runs the command again, pairs
with your machine, and registers the connector. This package's `mcp.json`
already holds that registration:

```json
{
  "mcpServers": {
    "overdeck": {
      "command": "npx",
      "args": [
        "-y",
        "@overdeck/core@0.77.0",
        "mcp",
        "connector",
        "serve",
        "--stdio"
      ]
    }
  }
}
```

If the command prints a newer version, use that one.

The pairing code works once and expires within 30 minutes. If it is
refused, click **Copy again** under Settings → Anywhere → Bots and paste
the new message.

## Status

Version 0.1.0. Not published or listed in any catalog. What was checked
before this release is recorded in [`docs/verification.md`](docs/verification.md).
Live use from Grok Bot itself has not yet been verified.

## What it includes

- The plugin manifest (`.cursor-plugin/plugin.json`) and `mcp.json`, which
  runs the Overdeck connector over stdio.
- The shared `overdeck` skill (`skills/overdeck/SKILL.md`), a copy of
  `integrations/shared/SKILL.md` — edit only the shared file, never this copy.
- Runnable xAI API examples in `examples/`.

No hooks and no credentials ship in this package.

## Before you start

The Public MCP routes below (Grok Bot over Public MCP and the xAI API) need
Public MCP switched on and published through Tailscale Funnel. See
[Public MCP for hosted bots](https://overdeck.ai/configuration/mcp) and, in
the dashboard, Settings → Anywhere → "Public MCP for hosted bots". The public
URL has the shape `https://<machine>.<tailnet>.ts.net:8443/mcp`. The Connect a
bot dialog (Settings → Anywhere → Bots) shows your exact URL.

## Grok Bot over Public MCP

**1. Replace `mcp.json` with your public URL.** For this route the file
holds the URL instead of the connector:

```json
{
  "mcpServers": {
    "overdeck": {
      "url": "https://YOUR-MACHINE.YOUR-TAILNET.ts.net:8443/mcp"
    }
  }
}
```

**2. Install the plugin** from this folder, or add the URL above as a custom
MCP server in Grok Bot.

**3. Approve the sign-in.** On first use, Grok Bot opens a sign-in page with
an approval code. Approve it in the dashboard's Needs you card (or run
`pan mcp oauth approve <code> --level read`) after checking the codes match,
and pick the access level — Read only unless you want more.

**4. Ask it:** "List my Overdeck conversations."

## xAI API

**1. Mint a token:**

```bash
pan mcp oauth issue --name 'xai-api' --level read
# Put the access token it prints in OVERDECK_MCP_TOKEN for the script.
```

**2. The request:**

```js
const response = await fetch("https://api.x.ai/v1/responses", {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.XAI_API_KEY}` },
  body: JSON.stringify({
    model: "grok-4.7",
    input: "List my Overdeck conversations.",
    tools: [{
      type: "mcp",
      server_url: "https://YOUR-MACHINE.YOUR-TAILNET.ts.net:8443/mcp",
      server_label: "overdeck",
      authorization: process.env.OVERDECK_MCP_TOKEN,
      allowed_tools: ["list_conversations", "read_conversation", "list_pending_input"],
    }],
  }),
});
console.log(await response.json());
```

**3. Runnable examples** need no dependencies — just these environment
variables:

| Variable | Required | Default |
| --- | --- | --- |
| `XAI_API_KEY` | yes | — |
| `OVERDECK_MCP_TOKEN` | yes | — |
| `OVERDECK_MCP_URL` | yes | — |
| `XAI_MODEL` | no | `grok-4.7` |
| `XAI_BASE_URL` | no | `https://api.x.ai/v1` |

```bash
node --experimental-strip-types examples/xai-api.ts "List my Overdeck conversations."
```

(Node 22.16+.)

```bash
python3 examples/xai-api.py "List my Overdeck conversations."
```

**4. Token life.** The access token lasts 30 days. Issue a new one and run
`pan mcp oauth revoke <sign-in id>` on the old sign-in
(`pan mcp oauth list` shows ids).

**5. The `authorization` field** holds the bare access token. xAI's docs
describe it as "a token that will be set in the Authorization header,"
matching OpenAI's Responses semantics, but whether xAI sends it bare or as
`Bearer <token>` has not been verified live — see
[`docs/verification.md`](docs/verification.md) (check CP-8c). If Overdeck
logs a 401 for the MCP call, change this field to `Bearer <token>` in both
examples and in `botSnippets.xaiExample`, then re-run.

## Access

| Level | Label | Scopes |
| --- | --- | --- |
| `read` | Read only | `read:state`, `read:conversations` |
| `message` | Can message | `read:state`, `read:conversations`, `tell` |
| `operate` | Can operate | `read:state`, `read:conversations`, `tell`, `operate` |
| `approve` | Can approve | `read:state`, `read:conversations`, `tell`, `operate`, `approve` |

`approve` lets the bot answer your permission prompts, so grant it only on
purpose.

## Troubleshooting

- **404** — Public MCP is off, or the Funnel paths are not published.
- **403 "public MCP accepts only OAuth sign-ins"** — the token came from
  `pan token create` or Copy MCP URL; use an OAuth sign-in instead.
- **401** — the token expired or was revoked.
- **429** — over 60 requests per minute per token; wait for the `Retry-After`
  header.
- **`GET /mcp` answers 405** — by design; Overdeck serves no standalone event
  stream.

## Turning it off

Switch Public MCP off, and end the sign-in under Settings → Access Tokens →
Sign-ins, or run `pan mcp oauth revoke`.

## License

MIT, see [LICENSE](LICENSE).
