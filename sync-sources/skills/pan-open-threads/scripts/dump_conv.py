#!/usr/bin/env python3
"""Dump the operator turns and assistant text turns of one Overdeck conversation.

Usage: dump_conv.py <conv-id> [max-chars-per-assistant-turn]

Handles claude-code JSONL (resolved through `pan conversations jsonl`), Codex
rollouts under ~/.overdeck/agents/conv-<name>/codex-home/, and OpenCode
sessions in ~/.local/share/opencode/opencode.db. Output blocks are
`>>> USER [ts]` and `--- ASST [ts]`. Codex dumps include the harness's own
approval-assessor prompts as USER blocks; readers must discount those.
"""
import datetime
import glob
import json
import os
import sqlite3
import subprocess
import sys

DASHBOARD = os.environ.get("OVERDECK_DASHBOARD_URL", "http://localhost:3011")


def fetch_meta(cid):
    out = subprocess.run(["curl", "-s", f"{DASHBOARD}/api/conversations/{cid}"], capture_output=True, text=True).stdout
    return json.loads(out)


def claude_turns(cid):
    env = dict(os.environ, OVERDECK_RTK_ENABLED="0")
    env.setdefault("OVERDECK_HOME", os.path.expanduser("~/.overdeck"))
    lines = subprocess.run(["pan", "conversations", "jsonl", str(cid)], capture_output=True, text=True, env=env).stdout.strip().splitlines()
    path = lines[-1] if lines else ""
    if not os.path.isfile(path):
        return None, path
    turns = []
    for line in open(path, errors="ignore"):
        try:
            r = json.loads(line)
        except ValueError:
            continue
        m = r.get("message") or {}
        c = m.get("content")
        ts = (r.get("timestamp") or "")[:16]
        if r.get("type") == "user":
            if isinstance(c, str):
                if not c.startswith("<"):
                    turns.append(("USER", ts, c))
            elif isinstance(c, list):
                for b in c:
                    if isinstance(b, dict) and b.get("type") == "text":
                        t = b["text"]
                        if not t.startswith("<") and not t.startswith("Base directory for this skill"):
                            turns.append(("USER", ts, t))
        if r.get("type") == "assistant" and isinstance(c, list):
            for b in c:
                if isinstance(b, dict) and b.get("type") == "text" and b["text"].strip():
                    turns.append(("ASST", ts, b["text"]))
    return turns, path


def codex_turns(name):
    files = sorted(glob.glob(os.path.expanduser(f"~/.overdeck/agents/conv-{name}/codex-home/sessions/**/rollout-*.jsonl"), recursive=True), key=os.path.getmtime)
    if not files:
        return None, ""
    turns = []
    for f in files:
        for line in open(f, errors="ignore"):
            try:
                r = json.loads(line)
            except ValueError:
                continue
            p = r.get("payload") or {}
            ts = (r.get("timestamp") or "")[:16]
            if r.get("type") == "response_item" and p.get("type") == "message":
                txt = " ".join(b.get("text", "") for b in (p.get("content") or []) if isinstance(b, dict))
                if p.get("role") == "user" and txt and not txt.startswith("<") and "<environment_context>" not in txt[:60]:
                    turns.append(("USER", ts, txt))
                if p.get("role") == "assistant" and txt:
                    turns.append(("ASST", ts, txt))
            if r.get("type") == "event_msg" and p.get("type") == "agent_message" and p.get("message"):
                turns.append(("ASST", ts, p["message"]))
    return turns, files[-1]


def opencode_turns(meta):
    db_path = os.path.expanduser("~/.local/share/opencode/opencode.db")
    if not os.path.isfile(db_path):
        return None, ""
    db = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    cur = db.cursor()
    created = meta.get("createdAt")
    cwd = meta.get("cwd")
    if not created or not cwd:
        return None, db_path
    t0 = datetime.datetime.fromisoformat(created.replace("Z", "+00:00")).timestamp() * 1000
    row = cur.execute(
        "select id from session where directory=? and parent_id is null and abs(time_created-?) < 120000 order by abs(time_created-?) limit 1",
        (cwd, t0, t0),
    ).fetchone()
    if not row:
        return None, db_path
    turns = []
    for mid, tc, data in cur.execute("select id,time_created,data from message where session_id=? order by time_created", (row[0],)):
        role = json.loads(data).get("role")
        texts = []
        for (pd,) in cur.execute("select data from part where message_id=? order by time_created", (mid,)):
            p = json.loads(pd)
            if p.get("type") == "text" and p.get("text"):
                texts.append(p["text"])
        txt = " ".join(texts).strip()
        if not txt or (role == "user" and txt.startswith("<")):
            continue
        ts = datetime.datetime.fromtimestamp(tc / 1000, datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M")
        turns.append(("USER" if role == "user" else "ASST", ts, txt))
    return turns, f"{db_path}#{row[0]}"


def main():
    cid = sys.argv[1]
    maxa = int(sys.argv[2]) if len(sys.argv) > 2 else 1500
    meta = fetch_meta(cid)
    harness = meta.get("harness")
    print(f"# conv {cid} | {meta.get('title')} | {harness}/{meta.get('model')} | project={meta.get('projectKey')} | cwd={meta.get('cwd')} | created={meta.get('createdAt')} | last={meta.get('lastActivityAt')}")
    if harness == "codex":
        turns, src = codex_turns(meta.get("name"))
    elif harness == "opencode":
        turns, src = opencode_turns(meta)
    else:
        turns, src = claude_turns(cid)
    if turns is None:
        print("NO TRANSCRIPT", src)
        return
    out = []
    for t in turns:
        if out and out[-1][0] == t[0] == "ASST" and out[-1][2] == t[2]:
            continue
        out.append(t)
    print(f"source: {src}")
    print(f"turns: {sum(1 for t in out if t[0]=='USER')} user / {sum(1 for t in out if t[0]=='ASST')} assistant")
    for role, ts, txt in out:
        if role == "USER":
            print(f"\n>>> USER [{ts}]\n{txt[:2500]}")
        else:
            print(f"\n--- ASST [{ts}]\n{txt[:maxa]}")


if __name__ == "__main__":
    main()
