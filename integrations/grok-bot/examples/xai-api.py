"""
PAN-4927 W-INT4: a runnable example that asks the xAI Responses API to call
Overdeck's public MCP server through a remote MCP tool.

Required environment variables:
  XAI_API_KEY         your xAI API key
  OVERDECK_MCP_TOKEN   the access token from `pan mcp oauth issue --name xai-api --level read`
  OVERDECK_MCP_URL     your published public MCP URL, https://<machine>.<tailnet>.ts.net:8443/mcp

Optional:
  XAI_MODEL     defaults to grok-4.7
  XAI_BASE_URL  defaults to https://api.x.ai/v1

Run (Python 3.9+):
  python3 integrations/grok-bot/examples/xai-api.py "List my Overdeck conversations."

See integrations/grok-bot/README.md.
"""

import json
import os
import sys
import urllib.error
import urllib.request

ALLOWED_TOOLS = ["list_conversations", "read_conversation", "list_pending_input"]
DEFAULT_MODEL = "grok-4.7"
SERVER_LABEL = "overdeck"


def redact(text, secrets):
    result = text
    for secret in secrets:
        if not secret:
            continue
        result = result.replace(secret, "[redacted]")
    return result


def main():
    xai_api_key = os.environ.get("XAI_API_KEY")
    overdeck_mcp_token = os.environ.get("OVERDECK_MCP_TOKEN")
    overdeck_mcp_url = os.environ.get("OVERDECK_MCP_URL")
    secrets = [value for value in (xai_api_key, overdeck_mcp_token) if value]

    if not xai_api_key or not overdeck_mcp_token or not overdeck_mcp_url:
        print(
            "Set XAI_API_KEY, OVERDECK_MCP_TOKEN and OVERDECK_MCP_URL. See integrations/grok-bot/README.md.",
            file=sys.stderr,
        )
        return 2

    if not overdeck_mcp_url.startswith("https://"):
        print(
            "OVERDECK_MCP_URL must be an https: URL, such as https://YOUR-MACHINE.YOUR-TAILNET.ts.net:8443/mcp",
            file=sys.stderr,
        )
        return 2

    model = os.environ.get("XAI_MODEL") or DEFAULT_MODEL
    base_url = (os.environ.get("XAI_BASE_URL") or "https://api.x.ai/v1").rstrip("/")
    prompt = sys.argv[1] if len(sys.argv) > 1 else "List my Overdeck conversations."

    body = {
        "model": model,
        "input": prompt,
        "tools": [{
            "type": "mcp",
            "server_url": overdeck_mcp_url,
            "server_label": SERVER_LABEL,
            "authorization": overdeck_mcp_token,
            "allowed_tools": ALLOWED_TOOLS,
        }],
    }

    request = urllib.request.Request(
        base_url + "/responses",
        data=json.dumps(body).encode("utf-8"),
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": "Bearer " + xai_api_key,
            "User-Agent": "overdeck-grok-bot-example/0.1.0",
        },
    )

    try:
        with urllib.request.urlopen(request) as response:
            raw = response.read().decode("utf-8")
    except urllib.error.HTTPError as error:
        text = error.read().decode("utf-8", errors="replace")
        print(redact("xAI API answered %d: %s" % (error.code, text[:2000]), secrets), file=sys.stderr)
        return 1
    except (urllib.error.URLError, OSError) as error:
        print(redact("Could not reach the xAI API: %s" % (error,), secrets), file=sys.stderr)
        return 1

    response_body = json.loads(raw)
    texts = []
    for item in response_body.get("output") or []:
        for entry in item.get("content") or []:
            if entry.get("type") == "output_text" and isinstance(entry.get("text"), str):
                texts.append(entry["text"])

    if texts:
        print(redact("\n".join(texts), secrets))
    else:
        print(redact(json.dumps(response_body, indent=2), secrets))
    return 0


if __name__ == "__main__":
    sys.exit(main())
