from __future__ import annotations

import copy

from conftest import FakeCtx, err, ok
from overdeck_hermes.commands import ANSWERS_OFF, USAGE, OverdeckCommands


def make(*listings, settings=None, mcp_allowlist=None, answers=None):
    clock = [0.0]
    responses = {"list_pending_input": list(listings)}
    responses.update(answers or {})
    ctx = FakeCtx(settings=settings, mcp_allowlist=mcp_allowlist, responses=responses)
    return ctx, OverdeckCommands(ctx, clock=lambda: clock[0]), clock


def tools_called(ctx):
    return [call[1] for call in ctx.calls]


def test_status_reachable(feed):
    _, commands, _ = make(ok(feed), settings={"allow_answers": True})
    assert commands.handle("status") == (
        'Overdeck: reachable through MCP server "overdeck". 14 things need you (run /overdeck pending).\n'
        "Summary: on. Answering from chat: on."
    )


def test_status_unreachable_names_server():
    _, commands, _ = make(ConnectionError("connection refused"), settings={"server": "od", "summary": False},
                          mcp_allowlist=["od"])
    assert commands.handle("") == (
        'Overdeck: not reachable through MCP server "od": Overdeck is not reachable: connection refused\n'
        "Summary: off. Answering from chat: off."
    )


def test_status_shows_fleet_error():
    data = {"machines": [], "fleetError": "laptop did not answer"}
    reply = make(ok(data))[1].handle("status")
    assert reply.splitlines() == [
        'Overdeck: reachable through MCP server "overdeck". 0 things need you.',
        "Summary: on. Answering from chat: off.",
        "Linked machines: laptop did not answer",
    ]


def test_pending_numbers_items_and_stores_snapshot(feed):
    ctx, commands, _ = make(ok(feed))
    lines = commands.handle("pending", session_key="chat-1").splitlines()
    assert lines[0] == "Overdeck: 14 things need you."
    assert lines[1] == "1. conv-ask (this machine) — question: Which database? (+1 more questions)"
    assert lines[2] == "   Answer: /overdeck answer 1 <one answer per question (2), separated by ' | '>"
    assert lines[3] == "   Question 1: 1) SQLite  2) Postgres"
    assert lines[4] == "   Question 2: 1) 3011  2) 3012"
    assert lines[5] == "2. conv-perm (this machine) — permission: Bash"
    assert lines[6] == "   Answer: /overdeck answer 2 <allow-once, allow-always or deny>"
    assert "   Options: 1) First  2) Second  3) Third" in lines
    assert "7. conv-held (this machine) — held handoff: a held handoff waits to start" in lines
    assert lines[lines.index("7. conv-held (this machine) — held handoff: a held handoff waits to start") + 1] == (
        "   answer it in the Overdeck dashboard")
    assert lines[-2].startswith("14. @env-2/agent-pan-1 (laptop)")
    assert set(commands._snapshots) == {"chat-1"}
    assert len(commands._snapshots["chat-1"][1]) == 14
    assert ctx.calls == [("overdeck", "list_pending_input", {}, 15)]


def test_pending_empty(feed):
    _, commands, _ = make(ok(feed), ok({"machines": []}))
    commands.handle("pending")
    assert commands.handle("pending") == "Overdeck: nothing needs you."
    assert commands._snapshots == {}


def test_answer_refused_when_allow_answers_false_makes_no_mcp_call():
    for settings in ({}, {"allow_answers": False}, {"allow_answers": "true"}):
        ctx, commands, _ = make(settings=settings)
        assert commands.handle("answer 1 deny") == ANSWERS_OFF
        assert ctx.calls == []


def test_answer_rechecks_setting_each_call(feed):
    ctx, commands, _ = make(ok(feed), ok(feed), ok(feed), settings={"allow_answers": True},
                            answers={"answer_permission": [ok({"ok": True})]})
    commands.handle("pending")
    assert commands.handle("answer 2 deny") == "Answered item 2 (conv-perm)."
    commands.handle("pending")
    calls_before = len(ctx.calls)
    ctx.settings["allow_answers"] = False
    assert commands.handle("answer 2 deny") == ANSWERS_OFF
    assert len(ctx.calls) == calls_before


def test_answer_requires_pending_first():
    ctx, commands, _ = make(settings={"allow_answers": True})
    assert commands.handle("answer 1 deny") == "Run /overdeck pending first, then answer by number."
    assert ctx.calls == []


def test_answer_snapshot_expires(feed):
    ctx, commands, clock = make(ok(feed), settings={"allow_answers": True})
    commands.handle("pending")
    clock[0] = 600.0
    assert commands.handle("answer 2 deny") == "Run /overdeck pending first, then answer by number."
    assert len(ctx.calls) == 1


def test_answer_unknown_number(feed):
    ctx, commands, _ = make(ok(feed), settings={"allow_answers": True})
    commands.handle("pending")
    assert commands.handle("answer 15 deny") == "There is no item 15. Run /overdeck pending again."
    assert commands.handle("answer 0 deny") == USAGE
    assert commands.handle("answer 2") == USAGE
    assert len(ctx.calls) == 1


def test_answer_refuses_stale_item_without_calling_tool(feed):
    fresh = copy.deepcopy(feed)
    fresh["machines"][0]["conversations"].pop(0)
    ctx, commands, _ = make(ok(feed), ok(fresh), settings={"allow_answers": True})
    commands.handle("pending")
    assert commands.handle("answer 1 1 | 2") == "Item 1 is no longer pending. Run /overdeck pending again."
    assert tools_called(ctx) == ["list_pending_input", "list_pending_input"]


def test_answer_calls_routed_tool_and_clears_snapshot(feed):
    ctx, commands, _ = make(ok(feed), ok(feed), ok(feed), ok(feed), settings={"allow_answers": True},
                            answers={"answer_permission": [ok({"answered": True})],
                                     "answer_question": [ok({"answered": True})]})
    commands.handle("pending", session_key="s")
    assert commands.handle("answer 2 allow-once", session_key="s") == "Answered item 2 (conv-perm)."
    assert ctx.calls[-1] == ("overdeck", "answer_permission",
                             {"conversation": "conv-perm", "signature": "sig-perm", "choice": "allow-once"}, 30)
    assert commands.handle("answer 1 1 | 2", session_key="s") == "Run /overdeck pending first, then answer by number."

    commands.handle("pending", session_key="s")
    assert commands.handle("answer 1 2 | port 4000", session_key="s") == "Answered item 1 (conv-ask)."
    assert ctx.calls[-1] == ("overdeck", "answer_question",
                             {"conversation": "conv-ask", "answers": ["Postgres", "port 4000"],
                              "questions": ["Which database?", "Which port?"]}, 30)
    assert "s" not in commands._snapshots


def test_answer_surfaces_missing_approve_text(feed):
    _, commands, _ = make(ok(feed), ok(feed), settings={"allow_answers": True},
                          answers={"answer_permission": [err("This token lacks the approve scope.")]})
    commands.handle("pending")
    reply = commands.handle("answer 2 deny")
    assert "This token lacks the approve scope." in reply
    assert reply.startswith("Overdeck refused the answer: ")
    assert "default" in commands._snapshots


def test_snapshots_are_per_session(feed):
    ctx, commands, _ = make(ok(feed), settings={"allow_answers": True})
    commands.handle("pending", session_key="chat-a")
    assert commands.handle("answer 2 deny", session_key="chat-b") == (
        "Run /overdeck pending first, then answer by number.")
    assert commands.handle("answer 2 deny") == "Run /overdeck pending first, then answer by number."
    assert len(ctx.calls) == 1


def test_unknown_subcommand_prints_usage():
    ctx, commands, _ = make()
    assert commands.handle("approve everything") == USAGE
    assert ctx.calls == []
