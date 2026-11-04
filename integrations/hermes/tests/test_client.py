from __future__ import annotations

import pytest

from conftest import FakeCtx, err, ok
from overdeck_hermes.client import OverdeckCallError, call_overdeck
from overdeck_hermes.config import Settings, read_settings


def test_call_overdeck_decodes_json_text_result():
    ctx = FakeCtx(responses={"list_pending_input": [ok({"machines": []})]})
    assert call_overdeck(ctx, "overdeck", "list_pending_input", {}, 10) == {"machines": []}
    assert ctx.calls == [("overdeck", "list_pending_input", {}, 10)]


def test_call_overdeck_returns_non_json_text_as_is():
    ctx = FakeCtx(responses={"list_pending_input": [{"ok": True, "result": '{"machines": [', "truncated": True}]})
    assert call_overdeck(ctx, "overdeck", "list_pending_input", {}, 10) == '{"machines": ['


def test_call_overdeck_raises_server_error_text():
    ctx = FakeCtx(responses={"answer_permission": [err("This token lacks the approve scope.")]})
    with pytest.raises(OverdeckCallError, match="This token lacks the approve scope."):
        call_overdeck(ctx, "overdeck", "answer_permission", {}, 30)


def test_call_overdeck_maps_permission_error_to_allowlist_hint():
    ctx = FakeCtx(mcp_allowlist=[])
    with pytest.raises(OverdeckCallError) as info:
        call_overdeck(ctx, "overdeck", "list_pending_input", {}, 10)
    assert "mcp_allowlist" in str(info.value)
    assert "'overdeck'" in str(info.value)
    assert ctx.calls == []


def test_call_overdeck_maps_transport_exception():
    ctx = FakeCtx(responses={"list_pending_input": [ConnectionError("connection refused")]})
    with pytest.raises(OverdeckCallError, match="Overdeck is not reachable: connection refused"):
        call_overdeck(ctx, "overdeck", "list_pending_input", {}, 10)


def test_read_settings_defaults():
    assert read_settings(FakeCtx()) == Settings(server="overdeck", summary=True, allow_answers=False)


@pytest.mark.parametrize("value", ["true", "yes", 1])
def test_read_settings_allow_answers_only_literal_true(value):
    assert read_settings(FakeCtx(settings={"allow_answers": value})).allow_answers is False
    assert read_settings(FakeCtx(settings={"allow_answers": True})).allow_answers is True


@pytest.mark.parametrize("value", ["", "   ", None, 7])
def test_read_settings_blank_server_falls_back(value):
    assert read_settings(FakeCtx(settings={"server": value})).server == "overdeck"
    assert read_settings(FakeCtx(settings={"server": " od "})).server == "od"
