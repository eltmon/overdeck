"""Overdeck plugin for Hermes Agent (PAN-4953, epic PAN-4927 W-INT1).

``register(ctx)`` adds the ``pre_llm_call`` pending summary (when the
``summary`` setting is on), the ``/overdeck`` chat command, the bundled
``overdeck`` skill and the ``hermes overdeck setup`` CLI command. It needs
Hermes 0.21.6 or later, the first release with ``ctx.call_mcp`` and
``ctx.get_config``; on an older Hermes it logs one warning and registers
nothing.

Imports inside this package are relative so a directory drop
(``~/.hermes/plugins/overdeck/``) loads too.
"""

from __future__ import annotations

import logging
from pathlib import Path

from .commands import OverdeckCommands
from .config import read_settings
from .summary import SummaryHook

logger = logging.getLogger(__name__)

SETUP_TEXT = "\n".join([
    "# ~/.hermes/config.yaml — connector route (default)",
    "mcp_servers:",
    "  overdeck:",
    '    url: "http://127.0.0.1:7466/mcp"',
    "    headers:",
    '      Authorization: "Bearer ${OVERDECK_CONNECTOR_LOCAL_TOKEN}"',
    "plugins:",
    "  enabled: [overdeck]",
    "  entries:",
    "    overdeck:",
    '      mcp_allowlist: ["overdeck"]',
    "      settings:",
    "        summary: true",
    "        allow_answers: false",
])


def skill_path() -> Path | None:
    """The bundled SKILL.md: inside the package (wheel, directory drop), else the repo copy (editable install)."""
    package_dir = Path(__file__).resolve().parent
    for candidate in (package_dir / "skills" / "overdeck" / "SKILL.md",
                      package_dir.parent.parent / "skills" / "overdeck" / "SKILL.md"):
        if candidate.is_file():
            return candidate
    return None


def _setup_cli(parser) -> None:
    subcommands = parser.add_subparsers(dest="overdeck_command", required=True)
    subcommands.add_parser("setup", help="Print the config.yaml block for the connector route")


def _run_cli(args) -> int:
    print(SETUP_TEXT)
    return 0


def register(ctx) -> None:
    if not callable(getattr(ctx, "call_mcp", None)) or not callable(getattr(ctx, "get_config", None)):
        logger.warning("[overdeck] This Hermes has no ctx.call_mcp; the Overdeck plugin needs Hermes 0.21.6 or later.")
        return
    settings = read_settings(ctx)
    if settings.summary:
        ctx.register_hook("pre_llm_call", SummaryHook(ctx).on_pre_llm_call)
    ctx.register_command("overdeck", handler=OverdeckCommands(ctx).handle,
                         description="Overdeck: status, pending prompts, answers",
                         args_hint="<status|pending|answer N CHOICE>")
    path = skill_path()
    if path is None:
        logger.warning("[overdeck] skills/overdeck/SKILL.md not found; the overdeck skill is not registered.")
    else:
        ctx.register_skill("overdeck", path, description="How to use the Overdeck tools safely.")
    ctx.register_cli_command("overdeck", help="Overdeck plugin setup",
                             setup_fn=_setup_cli, handler_fn=_run_cli)
