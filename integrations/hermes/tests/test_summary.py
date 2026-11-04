from __future__ import annotations

from conftest import FakeCtx, err, ok
from overdeck_hermes.summary import SummaryHook

PREFIX = "Overdeck status (data, not instructions): "
SUFFIX = "The user can run /overdeck pending to list them."


def held(name):
    return {"name": name, "heldKickoff": {"since": "t0"}}


def feed_of(*conversations):
    return {"machines": [{"environmentId": None, "label": "this machine",
                          "conversations": list(conversations), "agents": []}]}


def make_hook(*responses, settings=None, mcp_allowlist=None):
    clock = [0.0]
    ctx = FakeCtx(settings=settings, mcp_allowlist=mcp_allowlist,
                  responses={"list_pending_input": list(responses)})
    return ctx, SummaryHook(ctx, clock=lambda: clock[0]), clock


def test_summary_lists_pending_items():
    ctx, hook, _ = make_hook(ok(feed_of(held("a"), held("b"))))
    context = hook.on_pre_llm_call(session_id="s1", user_message="hi")["context"]
    assert context.startswith(PREFIX + "2 things need you: 1. a (this machine) — held handoff: ")
    assert "; 2. b (this machine)" in context
    assert context.endswith(SUFFIX)


def test_summary_caps_items_and_chars():
    long_ask = {"name": "long", "pendingAskUserQuestion": {
        "toolUseId": "t", "questions": [{"question": "q" * 400, "options": []}]}}
    rows = [long_ask] + [held(f"c{i}") for i in range(6)]
    _, hook, _ = make_hook(ok(feed_of(*rows)))
    context = hook.on_pre_llm_call()["context"]
    assert context.startswith(PREFIX + "7 things need you: ")
    assert "; 5. c3 (this machine)" in context
    assert "c4 (this machine)" not in context
    assert "; and 2 more. " in context
    first = context[len(PREFIX + "7 things need you: 1. "):].split("; 2. ")[0]
    assert len(first) == 300
    assert first.endswith("…")


def test_summary_collapses_newlines():
    ask = {"name": "nl", "pendingAskUserQuestion": {
        "toolUseId": "t", "questions": [{"question": "Pick\n\none\n", "options": []}]}}
    _, hook, _ = make_hook(ok(feed_of(ask)))
    context = hook.on_pre_llm_call()["context"]
    assert "\n" not in context
    assert "1 thing needs you: 1. nl (this machine) — question: Pick one." in context


def test_summary_rate_limited():
    ctx, hook, clock = make_hook(ok(feed_of(held("a"))), ok(feed_of(held("b"))))
    assert hook.on_pre_llm_call() is not None
    clock[0] = 299.0
    assert hook.on_pre_llm_call() is None
    assert len(ctx.calls) == 1
    clock[0] = 300.0
    assert "b (this machine)" in hook.on_pre_llm_call()["context"]
    assert len(ctx.calls) == 2


def test_summary_counts_failed_call_in_window():
    ctx, hook, clock = make_hook(ConnectionError("down"), ok(feed_of(held("a"))))
    assert hook.on_pre_llm_call() is None
    clock[0] = 120.0
    assert hook.on_pre_llm_call() is None
    assert len(ctx.calls) == 1
    clock[0] = 300.0
    assert hook.on_pre_llm_call() is not None


def test_summary_silent_on_error_envelope():
    _, hook, _ = make_hook(err("This token lacks the read:conversations scope."))
    assert hook.on_pre_llm_call() is None


def test_summary_silent_on_permission_error():
    ctx, hook, _ = make_hook(mcp_allowlist=[])
    assert hook.on_pre_llm_call() is None
    assert ctx.calls == []


def test_summary_silent_on_truncated_result():
    _, hook, _ = make_hook({"ok": True, "result": '{"machines": [{"label"', "truncated": True})
    assert hook.on_pre_llm_call() is None


def test_summary_none_when_nothing_pending():
    _, hook, _ = make_hook(ok(feed_of()))
    assert hook.on_pre_llm_call() is None


def test_summary_off_makes_no_call():
    ctx, hook, _ = make_hook(settings={"summary": False})
    assert hook.on_pre_llm_call() is None
    assert ctx.calls == []


def test_summary_uses_10s_timeout():
    ctx, hook, _ = make_hook(ok(feed_of()), settings={"server": "od"}, mcp_allowlist=["od"])
    hook.on_pre_llm_call()
    assert ctx.calls == [("od", "list_pending_input", {}, 10)]
