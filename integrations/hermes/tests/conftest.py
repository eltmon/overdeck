"""Shared test doubles for the Overdeck Hermes plugin (PAN-4953).

``FakeCtx`` stands in for Hermes's PluginContext: it records registrations,
serves queued ``call_mcp`` responses per tool, and refuses servers outside
``mcp_allowlist`` with ``PermissionError`` like Hermes does. No test needs
Hermes, a network or a real token; a token value a test needs is built at
runtime, never written as a literal.
"""

from __future__ import annotations

import json
import os

import pytest


def ok(data):
    return {"ok": True, "result": json.dumps(data, indent=2)}


def err(text):
    return {"ok": False, "error": text}


class FakeCtx:
    def __init__(self, settings=None, mcp_allowlist=None, responses=None):
        self.settings = dict(settings or {})
        self.mcp_allowlist = list(mcp_allowlist) if mcp_allowlist is not None else ["overdeck"]
        self.responses = {tool: list(queue) for tool, queue in (responses or {}).items()}
        self.calls = []
        self.hooks = []
        self.commands = []
        self.skills = []
        self.cli_commands = []

    def get_config(self, key, default=None):
        return self.settings.get(key, default)

    def call_mcp(self, server, tool, arguments=None, timeout=30):
        if server not in self.mcp_allowlist:
            raise PermissionError(f"plugin may not call MCP server {server!r}")
        self.calls.append((server, tool, arguments, timeout))
        queue = self.responses.get(tool)
        if not queue:
            raise AssertionError(f"no queued response for {tool}")
        response = queue.pop(0)
        if isinstance(response, BaseException):
            raise response
        return response

    def register_hook(self, name, cb):
        self.hooks.append((name, cb))

    def register_command(self, name, handler, description="", args_hint=""):
        self.commands.append((name, handler, description, args_hint))

    def register_skill(self, name, path, description=""):
        if not os.path.exists(path):
            raise FileNotFoundError(path)
        self.skills.append((name, path, description))

    def register_cli_command(self, name, help, setup_fn, handler_fn=None, description=""):
        self.cli_commands.append((name, help, setup_fn, handler_fn, description))


@pytest.fixture
def fake_token():
    return "odl_" + "0" * 64


@pytest.fixture
def feed():
    """A list_pending_input result covering every routing-table row."""
    return {
        "machines": [
            {
                "environmentId": None,
                "label": "this machine",
                "conversations": [
                    {
                        "name": "conv-ask",
                        "title": "Two questions",
                        "issueId": "PAN-1",
                        "harness": "claude-code",
                        "pendingAskUserQuestion": {
                            "toolUseId": "toolu_ask",
                            "askedAt": "2026-11-04T10:00:00Z",
                            "questions": [
                                {
                                    "question": "Which database?",
                                    "header": "DB",
                                    "multiSelect": False,
                                    "options": [{"label": "SQLite"}, {"label": "Postgres"}],
                                },
                                {
                                    "question": "Which port?",
                                    "options": [{"label": "3011"}, {"label": "3012"}],
                                },
                            ],
                        },
                    },
                    {
                        "name": "conv-perm",
                        "title": "Permission",
                        "issueId": None,
                        "harness": "claude-code",
                        "pendingPermission": {
                            "signature": "sig-perm",
                            "answerable": True,
                            "agentLabel": "Claude",
                            "toolName": "Bash",
                            "header": "Run a command",
                            "options": [
                                {"choice": "allow-once", "label": "Yes"},
                                {"choice": "allow-always", "label": "Yes, always"},
                                {"choice": "deny", "label": "No"},
                            ],
                            "since": "2026-11-04T10:01:00Z",
                        },
                    },
                    {
                        "name": "conv-codex",
                        "title": "Codex approval",
                        "harness": "codex",
                        "pendingAskUserQuestion": {
                            "toolUseId": "codex-approval:abc",
                            "askedAt": "2026-11-04T10:02:00Z",
                            "questions": [
                                {
                                    "question": "Allow codex to run tests?",
                                    "options": [{"label": "Yes"}, {"label": "No"}],
                                },
                            ],
                        },
                    },
                    {
                        "name": "conv-pi",
                        "title": "Pi ask",
                        "harness": "ohmypi",
                        "pendingAskUserQuestion": {
                            "toolUseId": "pi-ask-1",
                            "askedAt": "2026-11-04T10:03:00Z",
                            "questions": [
                                {
                                    "question": "Ship it?",
                                    "options": [{"label": "Ship"}, {"label": "Wait"}],
                                },
                            ],
                        },
                    },
                    {
                        "name": "conv-plan",
                        "title": "Plan",
                        "harness": "claude-code",
                        "pendingProposedPlan": {
                            "toolUseId": "toolu_plan",
                            "askedAt": "2026-11-04T10:04:00Z",
                            "plan": "1. Do it.\n2. Test it.",
                        },
                    },
                    {
                        "name": "conv-pane",
                        "title": "Pane choice",
                        "harness": "claude-code",
                        "pendingPaneChoice": {
                            "signature": "sig-pane",
                            "title": "Resume which session?",
                            "contextLines": [],
                            "options": [{"label": "First"}, {"label": "Second"}, {"label": "Third"}],
                            "selectedIndex": 0,
                        },
                    },
                    {
                        "name": "conv-held",
                        "title": "Held kickoff",
                        "harness": "claude-code",
                        "heldKickoff": {"since": "2026-11-04T10:05:00Z", "focus": "Continue"},
                    },
                ],
                "agents": [
                    {
                        "id": "agent-pan-2",
                        "issueId": "PAN-2",
                        "pendingInputKinds": ["permissionRequest", "askUserQuestion", "exitPlanMode"],
                        "pendingAskUserQuestion": {
                            "toolUseId": "toolu_agent_ask",
                            "askedAt": "2026-11-04T10:06:00Z",
                            "questions": [
                                {
                                    "question": "Keep the old API?",
                                    "options": [{"label": "Keep"}, {"label": "Drop"}],
                                },
                            ],
                        },
                        "permissionRequests": [
                            {
                                "requestId": "req-1",
                                "toolName": "Bash",
                                "description": "Run npm test",
                                "inputPreview": "npm test",
                                "createdAt": "2026-11-04T10:07:00Z",
                            },
                            {
                                "requestId": "req-2",
                                "toolName": "Write",
                                "description": "Write src/a.ts",
                                "inputPreview": "src/a.ts",
                                "createdAt": "2026-11-04T10:08:00Z",
                            },
                        ],
                    },
                    {
                        "id": "agent-pan-3",
                        "issueId": "PAN-3",
                        "pendingInputKinds": ["agentTurnEnded"],
                    },
                ],
            },
            {
                "environmentId": "env-2",
                "label": "laptop",
                "conversations": [
                    {
                        "name": "@env-2/fix-ci",
                        "title": "Fix CI",
                        "harness": "claude-code",
                        "pendingPermission": {
                            "signature": "sig-remote",
                            "answerable": True,
                            "agentLabel": "Claude",
                            "toolName": "Edit",
                            "header": "Edit a file",
                            "options": [
                                {"choice": "allow-once", "label": "Yes"},
                                {"choice": "deny", "label": "No"},
                            ],
                            "since": "2026-11-04T10:09:00Z",
                        },
                    },
                ],
                "agents": [
                    {
                        "id": "@env-2/agent-pan-1",
                        "issueId": "PAN-1",
                        "pendingInputKinds": ["permissionRequest"],
                        "remote": True,
                    },
                ],
            },
        ],
    }
