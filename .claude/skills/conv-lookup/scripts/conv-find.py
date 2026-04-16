#!/usr/bin/env python3
"""Find a Panopticon conversation by ID, list recent, or get session file path.

Usage:
    conv-find.py <conv_id>          # Find conversation by numeric ID
    conv-find.py --recent [N]       # List N most recent conversations (default 20)
    conv-find.py --search <query>   # Search by title/cwd/model (case-insensitive substring)
    conv-find.py --jsonl <conv_id>  # Same as <conv_id> but output only the JSONL path
"""

import argparse
import json
import sqlite3
import sys
import os

DB_PATH = os.path.expanduser("~/.panopticon/panopticon.db")

def get_db():
    if not os.path.exists(DB_PATH):
        print(f"Error: Panopticon database not found at {DB_PATH}", file=sys.stderr)
        sys.exit(1)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def list_recent(n=20):
    conn = get_db()
    rows = conn.execute(
        "SELECT id, name, tmux_session, status, cwd, issue_id, session_file, "
        "title, title_source, title_seed, total_cost, model, effort, created_at, ended_at "
        "FROM conversations ORDER BY id DESC LIMIT ?", (n,)
    ).fetchall()
    conn.close()

    for r in rows:
        status_icon = "" if r["status"] == "active" else "[E]"
        cost = f"${r['total_cost']:.2f}" if r["total_cost"] else "N/A"
        print(
            f"#{r['id']}{status_icon:3s} {r['name']:20s} [{r['status']:6s}] "
            f"model={r['model'] or '?':20s} cost={cost:8s} "
            f"cwd={r['cwd']} "
            f"title={r['title'] or r['title_seed'] or 'N/A'}"
        )

def find_by_id(conv_id):
    conn = get_db()
    row = conn.execute(
        "SELECT id, name, tmux_session, status, cwd, issue_id, session_file, "
        "title, title_source, title_seed, total_cost, model, effort, created_at, ended_at "
        "FROM conversations WHERE id = ?", (conv_id,)
    ).fetchone()
    conn.close()

    if not row:
        print(f"Conversation #{conv_id} not found", file=sys.stderr)
        sys.exit(1)

    info = {
        "id": row["id"],
        "name": row["name"],
        "tmux_session": row["tmux_session"],
        "status": row["status"],
        "cwd": row["cwd"],
        "issue_id": row["issue_id"],
        "session_file": row["session_file"],
        "title": row["title"],
        "title_source": row["title_source"],
        "title_seed": row["title_seed"],
        "total_cost": row["total_cost"],
        "model": row["model"],
        "effort": row["effort"],
        "created_at": row["created_at"],
        "ended_at": row["ended_at"],
    }
    return info

def search(query):
    conn = get_db()
    q = f"%{query}%"
    rows = conn.execute(
        "SELECT id, name, status, cwd, session_file, title, title_seed, "
        "total_cost, model, effort, created_at "
        "FROM conversations "
        "WHERE title LIKE ? OR cwd LIKE ? OR model LIKE ? OR name LIKE ? "
        "ORDER BY id DESC LIMIT 50",
        (q, q, q, q)
    ).fetchall()
    conn.close()

    if not rows:
        print(f"No conversations matching '{query}'", file=sys.stderr)
        sys.exit(1)

    for r in rows:
        cost = f"${r['total_cost']:.2f}" if r['total_cost'] else "N/A"
        print(
            f"#{r['id']} {r['name']:20s} [{r['status']:6s}] "
            f"model={r['model'] or '?':20s} cost={cost:8s} "
            f"title={r['title'] or r['title_seed'] or 'N/A'}"
        )

def print_session_summary(session_path):
    """Parse the first and last user prompts from a JSONL session."""
    import pathlib
    p = pathlib.Path(session_path)
    if not p.exists():
        print(f"  Session file not found: {session_path}")
        return

    first_user = None
    last_user = None
    total = 0
    for line in p.read_text().splitlines():
        if not line.strip():
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue
        msg = obj.get('message', {})
        if not msg:
            continue
        content = msg.get('content', '')
        if isinstance(content, list):
            for block in content:
                if isinstance(block, dict) and block.get('type') == 'text':
                    total += 1
                    t = block.get('text', '').strip()
                    if not t:
                        continue
                    if first_user is None:
                        first_user = t[:200]
                    last_user = t[:200]

    print(f"  Session messages: {total}")
    if first_user:
        print(f"  First prompt: {first_user}")
    if last_user and last_user != first_user:
        print(f"  Last prompt:  {last_user}")

def main():
    parser = argparse.ArgumentParser(description="Find Panopticon conversations")
    parser.add_argument("conv_id", nargs="?", type=int, help="Conversation ID to look up")
    parser.add_argument("--recent", nargs="?", const=20, type=int, help="List N recent conversations")
    parser.add_argument("--search", type=str, help="Search by title/cwd/model")
    parser.add_argument("--jsonl", action="store_true", help="Output only the JSONL file path")

    args = parser.parse_args()

    if args.recent is not None:
        list_recent(args.recent if args.recent else 20)
    elif args.search:
        search(args.search)
    elif args.conv_id:
        info = find_by_id(args.conv_id)
        if args.jsonl:
            print(info["session_file"] or "")
            sys.exit(0 if info["session_file"] else 1)
        print(f"Conversation #{info['id']}")
        print(f"  Name:          {info['name']}")
        print(f"  Status:        {info['status']}")
        print(f"  Model:         {info['model'] or 'N/A'}")
        print(f"  Effort:        {info['effort'] or 'N/A'}")
        print(f"  CWD:           {info['cwd']}")
        print(f"  Issue:         {info['issue_id'] or 'N/A'}")
        print(f"  Title:         {info['title'] or info['title_seed'] or 'N/A'}")
        print(f"  Cost:          ${info['total_cost']:.2f}" if info['total_cost'] else "  Cost:          N/A")
        print(f"  Created:       {info['created_at']}")
        if info['ended_at']:
            print(f"  Ended:         {info['ended_at']}")
        print(f"  Session file:  {info['session_file'] or 'N/A'}")
        if info['session_file']:
            print()
            print_session_summary(info['session_file'])
    else:
        parser.print_help()
        sys.exit(1)

if __name__ == "__main__":
    main()
