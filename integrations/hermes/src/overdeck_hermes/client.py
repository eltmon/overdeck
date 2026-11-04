"""The one caller of ``ctx.call_mcp`` in the Overdeck Hermes plugin (PAN-4953).

``ctx.call_mcp`` returns an envelope: ``{"ok": True, "result": "<text>"}`` on
success or ``{"ok": False, "error": "<text>"}`` when the tool refused. Overdeck
tools put JSON in that text, so a successful result is decoded a second time.
A result that is not JSON (for example a truncated one) comes back as the raw
string; callers that need a dict treat a string as an unreadable answer.
"""

from __future__ import annotations

import json

ALLOWLIST_HINT = ("Hermes has not granted this plugin the {server!r} MCP server. "
                  "Add it to plugins.entries.overdeck.mcp_allowlist in config.yaml.")


class OverdeckCallError(Exception):
    """A failed Overdeck tool call; str(error) is operator-readable."""


def call_overdeck(ctx, server: str, tool: str, arguments: dict, timeout: float):
    try:
        envelope = ctx.call_mcp(server, tool, arguments, timeout=timeout)
    except PermissionError as exc:
        raise OverdeckCallError(ALLOWLIST_HINT.format(server=server)) from exc
    except Exception as exc:  # the MCP client's own failures (connect, timeout)
        raise OverdeckCallError(f"Overdeck is not reachable: {exc}") from exc
    if not isinstance(envelope, dict) or not envelope.get("ok"):
        error = envelope.get("error") if isinstance(envelope, dict) else None
        raise OverdeckCallError(str(error) if error else "The Overdeck tool call failed.")
    result = envelope.get("result")
    if isinstance(result, str):
        try:
            return json.loads(result)
        except ValueError:
            return result
    return result
