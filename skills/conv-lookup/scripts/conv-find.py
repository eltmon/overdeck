#!/usr/bin/env python3
"""Find a Panopticon conversation by ID, list recent, or inspect session content.

Usage:
    conv-find.py <conv_id>             # Find conversation by numeric ID
    conv-find.py --recent [N]          # List N most recent conversations (default 20)
    conv-find.py --search <query>      # Search by title/cwd/model (case-insensitive substring)
    conv-find.py --jsonl <conv_id>     # Same as <conv_id> but output only the JSONL path
    conv-find.py --summary <conv_id>   # Print recent normalized message summaries
    conv-find.py --json <conv_id>      # Output metadata + session summary as JSON
"""

import argparse
import json
import os
import sqlite3
import sys
from collections import Counter, deque
from pathlib import Path
from typing import Any

DB_PATH = os.path.expanduser("~/.panopticon/panopticon.db")


def get_db():
    if not os.path.exists(DB_PATH):
        print(f"Error: Panopticon database not found at {DB_PATH}", file=sys.stderr)
        sys.exit(1)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "name": row["name"],
        "tmux_session": row.get("tmux_session") if hasattr(row, "get") else row["tmux_session"] if "tmux_session" in row.keys() else None,
        "status": row["status"],
        "cwd": row["cwd"],
        "issue_id": row["issue_id"] if "issue_id" in row.keys() else None,
        "session_file": row["session_file"],
        "title": row["title"] if "title" in row.keys() else None,
        "title_source": row["title_source"] if "title_source" in row.keys() else None,
        "title_seed": row["title_seed"] if "title_seed" in row.keys() else None,
        "total_cost": row["total_cost"] if "total_cost" in row.keys() else None,
        "model": row["model"] if "model" in row.keys() else None,
        "effort": row["effort"] if "effort" in row.keys() else None,
        "created_at": row["created_at"] if "created_at" in row.keys() else None,
        "ended_at": row["ended_at"] if "ended_at" in row.keys() else None,
    }


def display_title(info: dict[str, Any]) -> str:
    return info.get("title") or info.get("title_seed") or "N/A"


def format_cost(value: Any) -> str:
    return f"${value:.2f}" if value else "N/A"


def list_recent(n=20, *, as_json=False):
    conn = get_db()
    rows = conn.execute(
        "SELECT id, name, tmux_session, status, cwd, issue_id, session_file, "
        "title, title_source, title_seed, total_cost, model, effort, created_at, ended_at "
        "FROM conversations ORDER BY id DESC LIMIT ?",
        (n,),
    ).fetchall()
    conn.close()

    items = [row_to_dict(r) for r in rows]
    if as_json:
        print(json.dumps(items, indent=2))
        return

    for info in items:
        status_icon = "" if info["status"] == "active" else "[E]"
        print(
            f"#{info['id']}{status_icon:3s} {info['name']:20s} [{info['status']:6s}] "
            f"model={info['model'] or '?':20s} cost={format_cost(info['total_cost']):8s} "
            f"cwd={info['cwd']} "
            f"title={display_title(info)}"
        )


def find_by_id(conv_id):
    conn = get_db()
    row = conn.execute(
        "SELECT id, name, tmux_session, status, cwd, issue_id, session_file, "
        "title, title_source, title_seed, total_cost, model, effort, created_at, ended_at "
        "FROM conversations WHERE id = ?",
        (conv_id,),
    ).fetchone()
    conn.close()

    if not row:
        print(f"Conversation #{conv_id} not found", file=sys.stderr)
        sys.exit(1)

    return row_to_dict(row)


def search(query, *, as_json=False):
    conn = get_db()
    q = f"%{query}%"
    rows = conn.execute(
        "SELECT id, name, tmux_session, status, cwd, issue_id, session_file, title, title_source, title_seed, "
        "total_cost, model, effort, created_at, ended_at "
        "FROM conversations "
        "WHERE title LIKE ? OR cwd LIKE ? OR model LIKE ? OR name LIKE ? "
        "ORDER BY id DESC LIMIT 50",
        (q, q, q, q),
    ).fetchall()
    conn.close()

    if not rows:
        print(f"No conversations matching '{query}'", file=sys.stderr)
        sys.exit(1)

    items = [row_to_dict(r) for r in rows]
    if as_json:
        print(json.dumps(items, indent=2))
        return

    for info in items:
        print(
            f"#{info['id']} {info['name']:20s} [{info['status']:6s}] "
            f"model={info['model'] or '?':20s} cost={format_cost(info['total_cost']):8s} "
            f"title={display_title(info)}"
        )


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


def main():
    parser = argparse.ArgumentParser(description="Find Panopticon conversations")
    parser.add_argument("conv_id", nargs="?", type=int, help="Conversation ID to look up")
    parser.add_argument("--recent", nargs="?", const=20, type=int, help="List N recent conversations")
    parser.add_argument("--search", type=str, help="Search by title/cwd/model")
    parser.add_argument("--jsonl", action="store_true", help="Output only the JSONL file path")
    parser.add_argument("--summary", action="store_true", help="Print recent normalized session message summaries")
    parser.add_argument("--json", action="store_true", help="Output machine-readable JSON")

    args = parser.parse_args()

    if args.recent is not None:
        list_recent(args.recent if args.recent else 20, as_json=args.json)
    elif args.search:
        search(args.search, as_json=args.json)
    elif args.conv_id:
        info = find_by_id(args.conv_id)
        summary = get_session_summary(info["session_file"]) if info.get("session_file") else None
        if args.jsonl:
            print(info["session_file"] or "")
            sys.exit(0 if info["session_file"] else 1)
        if args.json:
            payload = dict(info)
            payload["session_summary"] = summary
            print(json.dumps(payload, indent=2))
            return

        print(f"Conversation #{info['id']}")
        print(f"  Name:          {info['name']}")
        print(f"  Status:        {info['status']}")
        print(f"  Model:         {info['model'] or 'N/A'}")
        print(f"  Effort:        {info['effort'] or 'N/A'}")
        print(f"  CWD:           {info['cwd']}")
        print(f"  Issue:         {info['issue_id'] or 'N/A'}")
        print(f"  Title:         {display_title(info)}")
        print(f"  Cost:          {format_cost(info['total_cost'])}")
        print(f"  Created:       {info['created_at']}")
        if info['ended_at']:
            print(f"  Ended:         {info['ended_at']}")
        print(f"  Session file:  {info['session_file'] or 'N/A'}")
        if summary:
            print()
            print_session_summary(summary)
            if args.summary:
                print()
                print_detailed_summary(summary)
    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
