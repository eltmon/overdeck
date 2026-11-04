"""The ``/overdeck`` chat command: ``status``, ``pending`` and ``answer`` (PAN-4953).

``answer`` is this package's security gate. It re-reads ``allow_answers`` on
every call and refuses before any MCP call when it is not exactly ``True``.
Numbers refer to the list ``pending`` last showed in the same chat session
(the snapshot, kept ``SNAPSHOT_TTL_SECONDS``). Before answering, the command
re-reads the pending list and answers only if the same item key is still
there, so a re-numbered list never routes an answer to a different prompt
(D-6).
"""

from __future__ import annotations

import re
import time

from .client import OverdeckCallError, call_overdeck
from .config import read_settings
from .pending import AnswerRefused, build_answer, flatten_pending

SNAPSHOT_TTL_SECONDS = 600
ANSWER_TIMEOUT_SECONDS = 30
LIST_TIMEOUT_SECONDS = 15
USAGE = "Usage: /overdeck status | pending | answer <n> <choice>"
ANSWERS_OFF = ("Answering from chat is off. Set plugins.entries.overdeck.settings.allow_answers: true "
               "in config.yaml to turn it on.")


def _needs(n: int) -> str:
    return f"{n} thing needs you" if n == 1 else f"{n} things need you"


def _unreachable(server: str, error) -> str:
    return f'Overdeck: not reachable through MCP server "{server}": {error}'


def _option_lines(item) -> list[str]:
    if item.route is None:
        return []
    groups = [labels for labels in item.route.get("options") or [] if labels]
    lines = []
    for index, labels in enumerate(groups, 1):
        prefix = "Options" if len(groups) == 1 else f"Question {index}"
        listed = "  ".join(f"{k}) {label}" for k, label in enumerate(labels, 1))
        lines.append(f"   {prefix}: {listed}")
    return lines


class OverdeckCommands:
    def __init__(self, ctx, clock=time.monotonic):
        self._ctx = ctx
        self._clock = clock
        self._snapshots: dict[str, tuple[float, list]] = {}

    def handle(self, raw_args: str, session_key: str | None = None) -> str:
        parts = (raw_args or "").split(None, 1)
        sub = parts[0] if parts else ""
        rest = parts[1] if len(parts) > 1 else ""
        session = session_key or "default"
        if sub in ("", "status"):
            return self.status()
        if sub == "pending":
            return self.pending(session)
        if sub == "answer":
            return self.answer(session, rest)
        return USAGE

    def _fetch(self, server: str):
        data = call_overdeck(self._ctx, server, "list_pending_input", {}, LIST_TIMEOUT_SECONDS)
        return data, flatten_pending(data)

    def status(self) -> str:
        settings = read_settings(self._ctx)
        try:
            data, items = self._fetch(settings.server)
        except (OverdeckCallError, ValueError) as error:
            data, first = None, _unreachable(settings.server, error)
        else:
            n = len(items)
            first = (f'Overdeck: reachable through MCP server "{settings.server}". '
                     f'{_needs(n)}{" (run /overdeck pending)" if n else ""}.')
        lines = [first, f"Summary: {'on' if settings.summary else 'off'}. "
                        f"Answering from chat: {'on' if settings.allow_answers else 'off'}."]
        if isinstance(data, dict) and data.get("fleetError"):
            lines.append(f"Linked machines: {data['fleetError']}")
        return "\n".join(lines)

    def pending(self, session: str) -> str:
        settings = read_settings(self._ctx)
        try:
            _, items = self._fetch(settings.server)
        except (OverdeckCallError, ValueError) as error:
            return _unreachable(settings.server, error)
        if not items:
            self._snapshots.pop(session, None)
            return "Overdeck: nothing needs you."
        self._snapshots[session] = (self._clock(), items)
        lines = [f"Overdeck: {_needs(len(items))}."]
        for i, item in enumerate(items, 1):
            lines.append(f"{i}. {item.text}")
            if item.route is None:
                lines.append(f"   {item.hint}")
            else:
                lines.append(f"   Answer: /overdeck answer {i} <{item.hint}>")
            lines.extend(_option_lines(item))
        return "\n".join(lines)

    def answer(self, session: str, rest: str) -> str:
        parts = (rest or "").split(None, 1)
        if len(parts) != 2 or not re.fullmatch(r"\d+", parts[0]) or int(parts[0]) < 1 or not parts[1].strip():
            return USAGE
        n, choice = int(parts[0]), parts[1].strip()

        # The gate: re-read on every call, and refuse before any MCP call.
        settings = read_settings(self._ctx)
        if not settings.allow_answers:
            return ANSWERS_OFF

        snapshot = self._snapshots.get(session)
        if snapshot is None or self._clock() - snapshot[0] >= SNAPSHOT_TTL_SECONDS:
            return "Run /overdeck pending first, then answer by number."
        items = snapshot[1]
        if n > len(items):
            return f"There is no item {n}. Run /overdeck pending again."
        item = items[n - 1]
        try:
            tool, arguments = build_answer(item, choice)
        except AnswerRefused as refusal:
            return str(refusal)

        try:
            _, fresh = self._fetch(settings.server)
        except (OverdeckCallError, ValueError) as error:
            return f"Could not check that item is still pending: {error}"
        if item.key not in {other.key for other in fresh}:
            return f"Item {n} is no longer pending. Run /overdeck pending again."

        try:
            call_overdeck(self._ctx, settings.server, tool, arguments, ANSWER_TIMEOUT_SECONDS)
        except OverdeckCallError as error:
            return f"Overdeck refused the answer: {error}"
        self._snapshots.pop(session, None)
        return f"Answered item {n} ({item.target})."
