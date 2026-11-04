from __future__ import annotations

import pytest

from overdeck_hermes.pending import AnswerRefused, build_answer, flatten_pending


def by_key(items, target, kind):
    return next(item for item in items if item.target == target and item.kind == kind)


def test_flatten_orders_items_and_keys(feed):
    items = flatten_pending(feed)
    assert [item.key for item in items] == [
        ("conv-ask", "question", "toolu_ask"),
        ("conv-perm", "permission", "sig-perm"),
        ("conv-codex", "question", "codex-approval:abc"),
        ("conv-pi", "question", "pi-ask-1"),
        ("conv-plan", "plan", "toolu_plan"),
        ("conv-pane", "pane-choice", "sig-pane"),
        ("conv-held", "held-kickoff", "2026-11-04T10:05:00Z"),
        ("agent-pan-2", "agent-permission", "req-1"),
        ("agent-pan-2", "agent-permission", "req-2"),
        ("agent-pan-2", "agent-question", "toolu_agent_ask"),
        ("agent-pan-2", "agent-plan", ""),
        ("agent-pan-3", "other", "agentTurnEnded"),
        ("@env-2/fix-ci", "permission", "sig-remote"),
        ("@env-2/agent-pan-1", "other", "permissionRequest"),
    ]
    assert [item.machine for item in items][-2:] == ["laptop", "laptop"]
    assert items[0].text == "conv-ask (this machine) — question: Which database? (+1 more questions)"
    assert by_key(items, "agent-pan-3", "other").text == "agent-pan-3 (this machine) — needs you: waiting: agentTurnEnded"
    remote = by_key(items, "@env-2/agent-pan-1", "other")
    assert remote.route is None
    assert remote.hint == "answer it in the Overdeck dashboard"
    assert remote.text.endswith("runs on a linked machine; answer it there")


def test_flatten_keeps_every_kind_of_one_conversation_in_order():
    row = {
        "name": "both",
        "heldKickoff": {"since": "t0"},
        "pendingProposedPlan": {"toolUseId": "p1"},
        "pendingPermission": {"signature": "s1", "answerable": True, "toolName": "Bash"},
    }
    items = flatten_pending({"machines": [{"label": "m", "conversations": [row], "agents": []}]})
    assert [item.kind for item in items] == ["permission", "plan", "held-kickoff"]


@pytest.mark.parametrize("data", [None, [], "text", {}, {"machines": None}, {"machines": {}}])
def test_flatten_rejects_unreadable_result(data):
    with pytest.raises(ValueError, match="unreadable list_pending_input result"):
        flatten_pending(data)


def test_flatten_skips_non_dict_entries():
    data = {"machines": ["x", {"label": "m", "conversations": [1, None], "agents": ["y"]}]}
    assert flatten_pending(data) == []


def test_item_text_collapses_whitespace():
    row = {
        "name": "multi",
        "pendingAskUserQuestion": {
            "toolUseId": "t1",
            "questions": [{"question": "Line one\n\n  line\ttwo  ", "options": []}],
        },
    }
    [item] = flatten_pending({"machines": [{"label": "this\nmachine", "conversations": [row]}]})
    assert item.text == "multi (this machine) — question: Line one line two"


@pytest.mark.parametrize(
    ("target", "kind", "choice", "tool", "args"),
    [
        pytest.param("conv-perm", "permission", "allow-always", "answer_permission",
                     {"conversation": "conv-perm", "signature": "sig-perm", "choice": "allow-always"},
                     id="answer_permission"),
        pytest.param("conv-codex", "question", "2", "answer_codex_approval",
                     {"conversation": "conv-codex", "toolUseId": "codex-approval:abc", "optionNumber": 2},
                     id="answer_codex_approval"),
        pytest.param("conv-pi", "question", "1", "answer_pi_ask",
                     {"conversation": "conv-pi", "toolUseId": "pi-ask-1", "answers": ["Ship"]},
                     id="answer_pi_ask"),
        pytest.param("conv-ask", "question", "2 | use 4000", "answer_question",
                     {"conversation": "conv-ask", "answers": ["Postgres", "use 4000"],
                      "questions": ["Which database?", "Which port?"]},
                     id="answer_question-conversation"),
        pytest.param("conv-plan", "plan", "reject-feedback  add tests first", "answer_plan",
                     {"conversation": "conv-plan", "action": "reject-feedback", "feedback": "add tests first"},
                     id="answer_plan"),
        pytest.param("conv-pane", "pane-choice", "3", "answer_pane_choice",
                     {"conversation": "conv-pane", "signature": "sig-pane", "selectedIndex": 2},
                     id="answer_pane_choice"),
        pytest.param("agent-pan-2", "agent-permission", "deny", "answer_agent_permission",
                     {"agentId": "agent-pan-2", "requestId": "req-1", "behavior": "deny"},
                     id="answer_agent_permission"),
        pytest.param("agent-pan-2", "agent-question", "Drop it", "answer_question",
                     {"agentId": "agent-pan-2", "toolUseId": "toolu_agent_ask", "answers": ["Drop it"]},
                     id="answer_question-agent"),
        pytest.param("agent-pan-2", "agent-plan", "approve-manual", "answer_agent_plan",
                     {"agentId": "agent-pan-2", "action": "approve-manual"},
                     id="answer_agent_plan"),
        pytest.param("@env-2/fix-ci", "permission", "allow-once", "answer_permission",
                     {"conversation": "@env-2/fix-ci", "signature": "sig-remote", "choice": "allow-once"},
                     id="answer_permission-linked-machine"),
    ],
)
def test_build_answer_routes(feed, target, kind, choice, tool, args):
    assert build_answer(by_key(flatten_pending(feed), target, kind), choice) == (tool, args)


def test_option_number_maps_to_label(feed):
    items = flatten_pending(feed)
    assert build_answer(by_key(items, "agent-pan-2", "agent-question"), "1")[1]["answers"] == ["Keep"]
    # An integer outside the options is free text, not a refusal.
    assert build_answer(by_key(items, "conv-pi", "question"), "7")[1]["answers"] == ["7"]
    assert build_answer(by_key(items, "conv-ask", "question"), "1 | 2")[1]["answers"] == ["SQLite", "3012"]


def test_pane_choice_is_one_based(feed):
    item = by_key(flatten_pending(feed), "conv-pane", "pane-choice")
    assert build_answer(item, "1")[1]["selectedIndex"] == 0
    assert item.hint == "an option number from 1 to 3"


def held_permission_item():
    row = {"name": "unanswerable", "pendingPermission": {"signature": None, "answerable": False, "header": "Trust?"}}
    [item] = flatten_pending({"machines": [{"label": "m", "conversations": [row]}]})
    return item


@pytest.mark.parametrize(
    ("target", "kind", "choice", "message"),
    [
        pytest.param("conv-perm", "permission", "yes", "'yes' is not a valid answer here. "
                     "Use: allow-once, allow-always or deny.", id="bad-permission-word"),
        pytest.param("conv-perm", "permission", "  ", "Give a choice: allow-once, allow-always or deny.",
                     id="empty-choice"),
        pytest.param("conv-pane", "pane-choice", "0", "'0' is not a valid answer here. "
                     "Use: an option number from 1 to 3.", id="pane-index-0"),
        pytest.param("conv-pane", "pane-choice", "4", "'4' is not a valid answer here. "
                     "Use: an option number from 1 to 3.", id="pane-index-4"),
        pytest.param("conv-codex", "question", "x", "'x' is not a valid answer here. "
                     "Use: an option number from 1 to 9.", id="codex-not-a-number"),
        pytest.param("conv-ask", "question", "1", "This prompt has 2 questions; "
                     "separate the answers with ' | '.", id="question-count-mismatch"),
        pytest.param("conv-ask", "question", "1 | ", "This prompt has 2 questions; "
                     "separate the answers with ' | '.", id="question-empty-part"),
        pytest.param("conv-plan", "plan", "reject-feedback", "reject-feedback needs the feedback text after it.",
                     id="reject-feedback-alone"),
        pytest.param("conv-plan", "plan", "approve-auto now", "'approve-auto now' is not a valid answer here. "
                     "Use: approve-auto, approve-manual, reject-ultraplan or reject-feedback <text>.",
                     id="plan-action-with-trailing-text"),
        pytest.param("agent-pan-2", "agent-permission", "allow-once", "'allow-once' is not a valid answer here. "
                     "Use: allow or deny.", id="agent-permission-word"),
        pytest.param("@env-2/agent-pan-1", "other", "allow", "Answer this one in the Overdeck dashboard.",
                     id="remote-agent"),
        pytest.param("conv-held", "held-kickoff", "go", "Answer this one in the Overdeck dashboard.",
                     id="held-kickoff"),
    ],
)
def test_build_answer_refuses(feed, target, kind, choice, message):
    item = by_key(flatten_pending(feed), target, kind)
    with pytest.raises(AnswerRefused) as info:
        build_answer(item, choice)
    assert str(info.value) == message


def test_build_answer_refuses_permission_without_signature():
    item = held_permission_item()
    assert item.key == ("unanswerable", "permission", "")
    assert item.route is None
    assert item.hint == "answer it in the Overdeck dashboard"
    with pytest.raises(AnswerRefused, match="Answer this one in the Overdeck dashboard."):
        build_answer(item, "allow-once")
