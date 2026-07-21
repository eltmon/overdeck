#!/usr/bin/env python3
"""Find an Overdeck conversation by ID, list recent, or inspect session content.

All conversation/session metadata is resolved through the canonical `pan conv`
CLI (the read door) — never by reading the Overdeck SQLite DB directly. Direct
DB access broke across the rebrand (the active DB moved from ~/.panopticon to
~/.overdeck/overdeck.db and the conversations schema changed: UUID ids,
claude_session_id moved into conversation_files). Routing through `pan conv`
keeps this skill correct regardless of where the DB lives or how its schema
evolves. See PAN-2019.

Usage:
    conv-find.py <conv_id>             # Find conversation by numeric ID
    conv-find.py --recent [N]          # List N recent sessions (default 20)
    conv-find.py --search <query>      # Search sessions by model/workspace/tools/files
    conv-find.py --jsonl <conv_id>     # Same as <conv_id> but output only the JSONL path
    conv-find.py --summary <conv_id>   # Print recent normalized message summaries
    conv-find.py --json <conv_id>      # Output metadata + session summary as JSON
"""

import argparse
import json
import subprocess
import sys
from collections import Counter, deque
from pathlib import Path
from typing import Any


# ─── CLI door helpers ─────────────────────────────────────────────────────────


def run_pan_json(args: list[str], *, quiet: bool = False) -> Any:
    """Run `pan <args>` and return parsed JSON, or None on any failure.

    When `quiet`, suppress the stderr diagnostic (used for fallible probes where
    a miss is an expected branch, not an error to report).
    """
    command = ["pan", *args]
    try:
        result = subprocess.run(command, capture_output=True, check=False, text=True)
    except FileNotFoundError:
        if not quiet:
            print("Error: `pan` command not found on PATH.", file=sys.stderr)
        return None
    if result.returncode != 0:
        if not quiet:
            detail = (result.stderr or result.stdout).strip().splitlines()
            suffix = f": {detail[0]}" if detail else ""
            print(f"Error: {' '.join(command)} failed{suffix}", file=sys.stderr)
        return None
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError:
        if not quiet:
            print(f"Error: {' '.join(command)} returned malformed JSON.", file=sys.stderr)
        return None


def resolve_session_file(conv_id: int) -> tuple[str | None, str]:
    """Resolve the transcript JSONL path via the canonical `pan conv jsonl` door."""
    payload = run_pan_json(["conv", "jsonl", "--json", str(conv_id)])
    if not isinstance(payload, dict):
        return None, "unknown"
    status = payload.get("status")
    if status not in {"ok", "expired", "unknown"}:
        return None, "unknown"
    path = payload.get("path")
    return (path if isinstance(path, str) else None), status


def find_conversation(conv_id: int) -> dict[str, Any] | None:
    """Look up conversation metadata through the canonical `pan conv show` door.

    Post-PAN-2018, `pan conv show --json <id>` resolves as a conversation first
    and returns a `conversation` block. On older main it returns a flat session
    object, so we fall back to `pan conv jsonl --json` for the basics.
    """
    payload = run_pan_json(["conv", "show", "--json", str(conv_id)], quiet=True)
    conv = payload.get("conversation") if isinstance(payload, dict) else None
    if isinstance(conv, dict) and conv.get("id") is not None:
        return _normalize_conversation(conv)

    # Fallback: derive what we can from the transcript resolver.
    j = run_pan_json(["conv", "jsonl", "--json", str(conv_id)], quiet=True)
    if not isinstance(j, dict) or j.get("conversationId") is None:
        return None
    return _normalize_conversation({
        "id": j.get("conversationId"),
        "claudeSessionId": j.get("claudeSessionId"),
        "cwd": j.get("cwd"),
    })


def _normalize_conversation(c: dict[str, Any]) -> dict[str, Any]:
    """Map a CLI conversation dict to the snake_case info shape this script prints."""
    return {
        "id": c.get("id"),
        "name": c.get("name"),
        "tmux_session": c.get("tmuxSession"),
        "status": c.get("status"),
        "cwd": c.get("cwd"),
        "issue_id": c.get("issueId"),
        "claude_session_id": c.get("claudeSessionId"),
        "title": c.get("title"),
        "title_seed": c.get("title"),  # conversations table no longer has title_seed
        "total_cost": c.get("totalCost"),
        "model": c.get("model"),
        "effort": c.get("effort"),
        "created_at": c.get("createdAt"),
        "ended_at": c.get("endedAt"),
    }


def list_sessions(limit: int = 20) -> list[dict[str, Any]]:
    payload = run_pan_json(["conv", "list", "--format", "json", "--limit", str(limit)])
    return payload if isinstance(payload, list) else []


def search_sessions(query: str, limit: int = 200) -> list[dict[str, Any]]:
    """Client-side substring search over discovered sessions (no DB door for search)."""
    sessions = list_sessions(limit)
    q = query.lower()
    matches: list[dict[str, Any]] = []
    for s in sessions:
        haystack = " ".join(
            str(s.get(k, ""))
            for k in ("primaryModel", "workspacePath", "jsonlPath", "summary", "panIssueId")
        ).lower()
        # Also search models used and tools/files touched.
        for key in ("modelsUsed", "toolsUsed", "filesTouched"):
            haystack += " " + " ".join(str(x).lower() for x in (s.get(key) or []))
        if q in haystack:
            matches.append(s)
    return matches


# ─── Display helpers ──────────────────────────────────────────────────────────


def display_title(info: dict[str, Any]) -> str:
    return info.get("title") or info.get("title_seed") or "N/A"


def format_cost(value: Any) -> str:
    return f"${value:.2f}" if value else "N/A"


def print_session_row(s: dict[str, Any]) -> None:
    model = s.get("primaryModel") or "?"
    cost = format_cost(s.get("estimatedCost"))
    msgs = s.get("messageCount", 0)
    cwd = s.get("workspacePath") or "?"
    last = (s.get("lastTs") or "")[:10]
    summary = (s.get("summary") or "").strip().splitlines()[0][:48] if s.get("summary") else ""
    print(f"#{s.get('id')}  {last}  msgs={msgs:<5} model={model:24} cost={cost:9} cwd={cwd}")
    if summary:
        print(f"       {summary}")


# ─── Transcript parsing (operates on the resolved JSONL file) ──────────────────


def normalize_whitespace(text: str) -> str:
    return " ".join(text.split())


def snippet(text: str, limit: int = 200) -> str:
    clean = normalize_whitespace(text)
    if len(clean) <= limit:
        return clean
    return clean[: limit - 3] + "..."


def extract_text_fragments(value: Any) -> list[str]:
    fragments: list[str] = []

    def visit(node: Any) -> None:
        if node is None:
            return
        if isinstance(node, str):
            text = node.strip()
            if text:
                fragments.append(text)
            return
        if isinstance(node, list):
            for item in node:
                visit(item)
            return
        if not isinstance(node, dict):
            return

        block_type = node.get("type")
        if block_type == "tool_use":
            return
        if block_type == "tool_result":
            visit(node.get("content"))
            return
        if block_type == "thinking":
            visit(node.get("thinking"))
            return
        if "text" in node:
            visit(node.get("text"))
            return
        if "content" in node:
            visit(node.get("content"))

    visit(value)
    return fragments


def extract_tool_names(value: Any) -> list[str]:
    names: list[str] = []
    if not isinstance(value, list):
        return names
    for block in value:
        if isinstance(block, dict) and block.get("type") == "tool_use":
            name = block.get("name")
            if isinstance(name, str) and name:
                names.append(name)
    return names


def iter_session_messages(session_path: str):
    path = Path(session_path)
    if not path.exists():
        return

    with path.open("r", encoding="utf-8") as handle:
        for line_no, line in enumerate(handle, 1):
            if not line.strip():
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue

            msg = obj.get("message")
            if not isinstance(msg, dict):
                continue

            content = msg.get("content")
            texts = extract_text_fragments(content)
            tools = extract_tool_names(content)
            role = msg.get("role") or "unknown"
            if not texts and not tools and not role:
                continue

            yield {
                "line": line_no,
                "timestamp": obj.get("timestamp"),
                "role": role,
                "texts": texts,
                "tools": tools,
            }


def get_session_summary(session_path: str | None) -> dict[str, Any] | None:
    if not session_path:
        return None

    path = Path(session_path)
    if not path.exists():
        return {
            "exists": False,
            "session_file": session_path,
        }

    message_count = 0
    role_counts: Counter[str] = Counter()
    tool_counts: Counter[str] = Counter()
    first_user = None
    last_user = None
    last_assistant = None
    recent: deque[dict[str, Any]] = deque(maxlen=10)

    for entry in iter_session_messages(session_path):
        message_count += 1
        role = entry["role"]
        role_counts[role] += 1
        for tool_name in entry["tools"]:
            tool_counts[tool_name] += 1

        first_text = entry["texts"][0] if entry["texts"] else None
        if role == "user" and first_text:
            if first_user is None:
                first_user = snippet(first_text)
            last_user = snippet(first_text)
        if role == "assistant" and first_text:
            last_assistant = snippet(first_text)

        if first_text or entry["tools"]:
            recent.append(
                {
                    "line": entry["line"],
                    "timestamp": entry["timestamp"],
                    "role": role,
                    "tools": entry["tools"],
                    "text": snippet(first_text) if first_text else None,
                }
            )

    return {
        "exists": True,
        "session_file": session_path,
        "message_count": message_count,
        "role_counts": dict(role_counts),
        "tool_use_count": sum(tool_counts.values()),
        "tool_names": dict(tool_counts),
        "first_user": first_user,
        "last_user": last_user,
        "last_assistant": last_assistant,
        "recent_messages": list(recent),
    }


def print_session_summary(summary: dict[str, Any] | None) -> None:
    if not summary:
        return
    if not summary.get("exists"):
        print(f"  Session file not found: {summary.get('session_file')}")
        return

    print(f"  Session messages: {summary['message_count']}")
    role_counts = summary.get("role_counts") or {}
    if role_counts:
        parts = [f"{role}={count}" for role, count in sorted(role_counts.items())]
        print(f"  By role:        {', '.join(parts)}")
    print(f"  Tool uses:      {summary.get('tool_use_count', 0)}")
    if summary.get("first_user"):
        print(f"  First prompt:   {summary['first_user']}")
    if summary.get("last_user") and summary.get("last_user") != summary.get("first_user"):
        print(f"  Last prompt:    {summary['last_user']}")
    if summary.get("last_assistant"):
        print(f"  Last assistant: {summary['last_assistant']}")


def print_detailed_summary(summary: dict[str, Any] | None) -> None:
    if not summary:
        return
    if not summary.get("exists"):
        print(f"Session file not found: {summary.get('session_file')}")
        return

    recent = summary.get("recent_messages") or []
    if not recent:
        print("No recent message details available.")
        return

    print("Recent notable messages:")
    for item in recent:
        tools = item.get("tools") or []
        tool_part = f" tools={tools}" if tools else ""
        text_part = f" text={item['text']}" if item.get("text") else ""
        print(f"  L{item['line']} {item['role']}{tool_part}{text_part}")


# ─── Main ─────────────────────────────────────────────────────────────────────


def main():
    parser = argparse.ArgumentParser(description="Find Overdeck conversations")
    parser.add_argument("conv_id", nargs="?", type=int, help="Conversation ID to look up")
    parser.add_argument("--recent", nargs="?", const=20, type=int, help="List N recent sessions")
    parser.add_argument("--search", type=str, help="Search sessions by model/workspace/tools/files")
    parser.add_argument("--jsonl", action="store_true", help="Output only the JSONL file path")
    parser.add_argument("--summary", action="store_true", help="Print recent normalized session message summaries")
    parser.add_argument("--json", action="store_true", help="Output machine-readable JSON")

    args = parser.parse_args()

    if args.recent is not None:
        sessions = list_sessions(args.recent if args.recent else 20)
        if args.json:
            print(json.dumps(sessions, indent=2))
            return
        if not sessions:
            print("No sessions found.")
            return
        for s in sessions:
            print_session_row(s)
        return

    if args.search:
        sessions = search_sessions(args.search)
        if args.json:
            print(json.dumps(sessions, indent=2))
            return
        if not sessions:
            print(f"No sessions matching '{args.search}'", file=sys.stderr)
            sys.exit(1)
        for s in sessions:
            print_session_row(s)
        return

    if args.conv_id:
        info = find_conversation(args.conv_id)
        if not info:
            print(f"Conversation #{args.conv_id} not found", file=sys.stderr)
            sys.exit(1)
        resolved, resolve_status = resolve_session_file(args.conv_id)
        info["resolved_session_file"] = resolved
        info["session_file_status"] = resolve_status
        summary = get_session_summary(resolved) if resolve_status == "ok" else None
        if args.jsonl:
            if resolve_status == "ok":
                print(resolved)
                sys.exit(0)
            if resolve_status == "expired":
                print(
                    f"Transcript JSONL not on disk (expected at {resolved}). "
                    "Claude Code retention deletes old transcripts.",
                    file=sys.stderr,
                )
            else:
                print("No claude_session_id recorded for this conversation.", file=sys.stderr)
            sys.exit(1)
        if args.json:
            payload = {key: value for key, value in info.items() if not key.startswith("_")}
            payload["session_summary"] = summary
            print(json.dumps(payload, indent=2))
            return

        print(f"Conversation #{info['id']}")
        print(f"  Name:          {info.get('name') or 'N/A'}")
        print(f"  Status:        {info.get('status') or 'N/A'}")
        print(f"  Model:         {info.get('model') or 'N/A'}")
        print(f"  Effort:        {info.get('effort') or 'N/A'}")
        print(f"  CWD:           {info.get('cwd') or 'N/A'}")
        print(f"  Issue:         {info.get('issue_id') or 'N/A'}")
        print(f"  Title:         {display_title(info)}")
        print(f"  Cost:          {format_cost(info.get('total_cost'))}")
        print(f"  Created:       {info.get('created_at') or 'N/A'}")
        if info.get('ended_at'):
            print(f"  Ended:         {info['ended_at']}")
        if resolve_status == "ok":
            print(f"  Session file:  {resolved}")
        elif resolve_status == "expired":
            print(f"  Session file:  {resolved}  (not on disk — transcript expired)")
        else:
            print("  Session file:  N/A (no claude_session_id recorded)")
        if summary:
            print()
            print_session_summary(summary)
            if args.summary:
                print()
                print_detailed_summary(summary)
        return

    parser.print_help()
    sys.exit(1)


if __name__ == "__main__":
    main()
