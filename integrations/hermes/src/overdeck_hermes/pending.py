"""Pending Overdeck prompts as numbered items, and the answer routing table (PAN-4953).

``flatten_pending`` turns a ``list_pending_input`` result into ``PendingItem``s
in a fixed order. ``build_answer`` turns an item plus the user's choice into
the answer tool call. The order, item keys, tools, arguments and accepted
choices follow the "Routing table for /overdeck answer" in
``.pan/drafts/PAN-4953.md``.

Server text is data: every item's text is collapsed to one line here, and the
summary clips it.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

DASHBOARD_HINT = "answer it in the Overdeck dashboard"

PERMISSION_CHOICES = ("allow-once", "allow-always", "deny")
AGENT_PERMISSION_CHOICES = ("allow", "deny")
PLAN_ACTIONS = ("approve-auto", "approve-manual", "reject-ultraplan", "reject-feedback")
PI_HARNESSES = ("ohmypi", "pi")
CODEX_APPROVAL_PREFIX = "codex-approval:"
ANSWER_SEPARATOR = " | "

KIND_LABELS = {
    "permission": "permission",
    "question": "question",
    "plan": "plan",
    "pane-choice": "choice",
    "held-kickoff": "held handoff",
    "agent-permission": "permission",
    "agent-question": "question",
    "agent-plan": "plan",
    "other": "needs you",
}


@dataclass(frozen=True)
class PendingItem:
    """One pending prompt.

    ``key`` is ``(target, kind, identity)`` and identifies the prompt across two
    reads. ``hint`` names the accepted choices, or says to use the dashboard.
    ``route`` is ``None`` when no answer tool applies; otherwise it holds:

    - ``tool``: the answer tool name;
    - ``args``: the identity arguments the tool needs;
    - ``accepts``: which choice parser applies (``permission``,
      ``agent-permission``, ``plan``, ``pane``, ``codex``, ``pi`` or
      ``questions``);
    - ``questions``: the question texts (asks only);
    - ``options``: option labels, one list per question for asks and a single
      list for pane choices.
    """

    key: tuple[str, str, str]
    machine: str
    target: str
    kind: str
    text: str
    hint: str
    route: dict | None


class AnswerRefused(Exception):
    """The choice cannot be sent; str(error) tells the user why."""


def one_line(text) -> str:
    return " ".join(str(text).split())


def _list(value) -> list:
    return [entry for entry in value if isinstance(entry, dict)] if isinstance(value, list) else []


def _str(value) -> str:
    return value if isinstance(value, str) else ""


def _item(machine, target, kind, identity, detail, hint, route) -> PendingItem:
    text = one_line(f"{target} ({machine}) — {KIND_LABELS[kind]}: {detail}")
    return PendingItem((target, kind, identity), machine, target, kind, text, hint, route)


def _ask_parts(ask: dict) -> tuple[list[str], list[list[str]]]:
    questions = _list(ask.get("questions"))
    texts = [_str(q.get("question")) for q in questions]
    options = [[_str(o.get("label")) for o in _list(q.get("options"))] for q in questions]
    return texts, options


def _ask_detail(texts: list[str]) -> str:
    if not texts:
        return "a question"
    more = f" (+{len(texts) - 1} more questions)" if len(texts) > 1 else ""
    return f"{texts[0]}{more}"


def _questions_hint(count: int) -> str:
    if count > 1:
        return f"one answer per question ({count}), separated by '{ANSWER_SEPARATOR}'"
    return "an option number or your own answer"


def _plan_hint() -> str:
    return "approve-auto, approve-manual, reject-ultraplan or reject-feedback <text>"


def _conversation_items(machine: str, row: dict) -> list[PendingItem]:
    name = _str(row.get("name"))
    items = []

    permission = row.get("pendingPermission")
    if isinstance(permission, dict):
        signature = permission.get("signature")
        detail = _str(permission.get("toolName")) or _str(permission.get("header")) or "a permission prompt"
        if permission.get("answerable") and isinstance(signature, str):
            route = {"tool": "answer_permission", "args": {"conversation": name, "signature": signature},
                     "accepts": "permission"}
            hint = "allow-once, allow-always or deny"
        else:
            route, hint = None, DASHBOARD_HINT
        identity = signature if isinstance(signature, str) else ""
        items.append(_item(machine, name, "permission", identity, detail, hint, route))

    ask = row.get("pendingAskUserQuestion")
    if isinstance(ask, dict):
        tool_use_id = _str(ask.get("toolUseId"))
        harness = _str(row.get("harness")) or "claude-code"
        texts, options = _ask_parts(ask)
        if harness == "codex" or tool_use_id.startswith(CODEX_APPROVAL_PREFIX):
            route = {"tool": "answer_codex_approval",
                     "args": {"conversation": name, "toolUseId": tool_use_id}, "accepts": "codex"}
            hint = "an option number from 1 to 9"
        elif harness in PI_HARNESSES:
            route = {"tool": "answer_pi_ask", "args": {"conversation": name, "toolUseId": tool_use_id},
                     "accepts": "pi"}
            hint = "an option number or your own answer"
        else:
            route = {"tool": "answer_question", "args": {"conversation": name}, "accepts": "questions"}
            hint = _questions_hint(len(texts))
        route.update(questions=texts, options=options)
        items.append(_item(machine, name, "question", tool_use_id, _ask_detail(texts), hint, route))

    plan = row.get("pendingProposedPlan")
    if isinstance(plan, dict):
        route = {"tool": "answer_plan", "args": {"conversation": name}, "accepts": "plan"}
        items.append(_item(machine, name, "plan", _str(plan.get("toolUseId")), "plan approval",
                           _plan_hint(), route))

    pane = row.get("pendingPaneChoice")
    if isinstance(pane, dict):
        labels = [_str(o.get("label")) for o in _list(pane.get("options"))]
        signature = _str(pane.get("signature"))
        route = {"tool": "answer_pane_choice", "args": {"conversation": name, "signature": signature},
                 "accepts": "pane", "options": [labels]}
        items.append(_item(machine, name, "pane-choice", signature, _str(pane.get("title")) or "a menu choice",
                           f"an option number from 1 to {len(labels)}", route))

    kickoff = row.get("heldKickoff")
    if isinstance(kickoff, dict):
        items.append(_item(machine, name, "held-kickoff", _str(kickoff.get("since")),
                           "a held handoff waits to start", DASHBOARD_HINT, None))

    return items


def _agent_items(machine: str, row: dict) -> list[PendingItem]:
    agent_id = _str(row.get("id"))
    kinds = [kind for kind in row.get("pendingInputKinds") or [] if isinstance(kind, str)]
    other_identity = ",".join(kinds)
    if row.get("remote") is True:
        return [_item(machine, agent_id, "other", other_identity,
                      "runs on a linked machine; answer it there", DASHBOARD_HINT, None)]

    items = []
    for request in _list(row.get("permissionRequests")):
        request_id = _str(request.get("requestId"))
        route = {"tool": "answer_agent_permission", "args": {"agentId": agent_id, "requestId": request_id},
                 "accepts": "agent-permission"}
        detail = f"{_str(request.get('toolName'))}: {_str(request.get('description'))}"
        items.append(_item(machine, agent_id, "agent-permission", request_id, detail, "allow or deny", route))

    ask = row.get("pendingAskUserQuestion")
    if isinstance(ask, dict):
        tool_use_id = _str(ask.get("toolUseId"))
        texts, options = _ask_parts(ask)
        route = {"tool": "answer_question", "args": {"agentId": agent_id, "toolUseId": tool_use_id},
                 "accepts": "questions", "questions": texts, "options": options}
        items.append(_item(machine, agent_id, "agent-question", tool_use_id, _ask_detail(texts),
                           _questions_hint(len(texts)), route))

    if "exitPlanMode" in kinds:
        route = {"tool": "answer_agent_plan", "args": {"agentId": agent_id}, "accepts": "plan"}
        items.append(_item(machine, agent_id, "agent-plan", "", "plan approval", _plan_hint(), route))

    if not items:
        items.append(_item(machine, agent_id, "other", other_identity,
                           "waiting: " + ", ".join(kinds), DASHBOARD_HINT, None))
    return items


def flatten_pending(data) -> list[PendingItem]:
    """Every pending prompt in ``data``, in routing-table order."""
    if not isinstance(data, dict) or not isinstance(data.get("machines"), list):
        raise ValueError("unreadable list_pending_input result")
    items = []
    for machine in _list(data["machines"]):
        label = _str(machine.get("label")) or _str(machine.get("environmentId")) or "unknown machine"
        for row in _list(machine.get("conversations")):
            items.extend(_conversation_items(label, row))
        for row in _list(machine.get("agents")):
            items.extend(_agent_items(label, row))
    return items


def _option_number(text: str) -> int | None:
    return int(text) if re.fullmatch(r"\d+", text) else None


def _resolve_answer(text: str, labels: list[str]) -> str:
    """A 1-based option number becomes its label; anything else is free text."""
    number = _option_number(text)
    if number is not None and 1 <= number <= len(labels) and labels[number - 1]:
        return labels[number - 1]
    return text


def build_answer(item: PendingItem, choice: str) -> tuple[str, dict]:
    """The ``(tool, arguments)`` call that answers ``item`` with ``choice``."""
    route = item.route
    if route is None:
        raise AnswerRefused("Answer this one in the Overdeck dashboard.")
    choice = (choice or "").strip()
    if not choice:
        raise AnswerRefused(f"Give a choice: {item.hint}.")
    invalid = AnswerRefused(f"'{choice}' is not a valid answer here. Use: {item.hint}.")
    tool, args, accepts = route["tool"], dict(route["args"]), route["accepts"]

    if accepts == "permission":
        if choice not in PERMISSION_CHOICES:
            raise invalid
        args["choice"] = choice
    elif accepts == "agent-permission":
        if choice not in AGENT_PERMISSION_CHOICES:
            raise invalid
        args["behavior"] = choice
    elif accepts == "plan":
        action, _, feedback = choice.partition(" ")
        feedback = feedback.strip()
        if action == "reject-feedback":
            if not feedback:
                raise AnswerRefused("reject-feedback needs the feedback text after it.")
            args.update(action=action, feedback=feedback)
        elif action in PLAN_ACTIONS and not feedback:
            args["action"] = action
        else:
            raise invalid
    elif accepts == "pane":
        number = _option_number(choice)
        if number is None or not 1 <= number <= len(route["options"][0]):
            raise invalid
        args["selectedIndex"] = number - 1
    elif accepts == "codex":
        number = _option_number(choice)
        if number is None or not 1 <= number <= 9:
            raise invalid
        args["optionNumber"] = number
    elif accepts == "pi":
        labels = route["options"][0] if route["options"] else []
        args["answers"] = [_resolve_answer(choice, labels)]
    else:  # questions
        count = len(route["questions"])
        parts = [part.strip() for part in choice.split(ANSWER_SEPARATOR)] if count > 1 else [choice]
        if len(parts) != count or not all(parts):
            raise AnswerRefused(f"This prompt has {count} questions; separate the answers with '{ANSWER_SEPARATOR}'.")
        args["answers"] = [_resolve_answer(part, labels) for part, labels in zip(parts, route["options"])]
        if "conversation" in args:
            args["questions"] = list(route["questions"])
    return tool, args
