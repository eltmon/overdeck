"""Plugin settings for the Overdeck Hermes plugin (PAN-4953, epic PAN-4927 D-21).

Hermes reads plugin settings from ``plugins.entries.overdeck.settings.<key>``
through ``ctx.get_config``. The plugin re-reads them on every use, so a change
in ``config.yaml`` applies without a restart, and the answer switch is never
cached.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    server: str = "overdeck"
    summary: bool = True
    allow_answers: bool = False


def read_settings(ctx) -> Settings:
    """Read the three settings.

    ``summary`` is on unless the value is exactly ``False``. ``allow_answers``
    is on only when the value is exactly ``True``, so a string such as
    ``"yes"`` keeps answering off (fails closed). A blank ``server`` falls back
    to ``"overdeck"``.
    """
    server = ctx.get_config("server", "overdeck")
    return Settings(
        server=server.strip() if isinstance(server, str) and server.strip() else "overdeck",
        summary=ctx.get_config("summary", True) is not False,
        allow_answers=ctx.get_config("allow_answers", False) is True,
    )
