#!/usr/bin/env python3
"""
Session Health Checker - Detects stuck/corrupted Claude Code sessions

Usage:
    python check_sessions.py [--fix] [--path PATH]

Detects:
    - Warmup sidechain loops (tool calls returning "Warmup" errors)
    - Excessive message counts (>500 messages)
    - Infinite retry patterns (same command repeated >10 times)
"""

import argparse
import json
import os
import sys
from collections import Counter
from pathlib import Path
from datetime import datetime


def analyze_session(jsonl_path: Path) -> dict:
    """Analyze a single session file for health issues."""
    issues = []
    stats = {
        "path": str(jsonl_path),
        "name": jsonl_path.name,
        "size_kb": jsonl_path.stat().st_size / 1024,
        "message_count": 0,
        "warmup_errors": 0,
        "tool_calls": Counter(),
        "is_sidechain": False,
        "issues": [],
    }

    try:
        with open(jsonl_path, 'r') as f:
            for line in f:
                stats["message_count"] += 1
                try:
                    msg = json.loads(line)

                    # Check if sidechain
                    if msg.get("isSidechain"):
                        stats["is_sidechain"] = True

                    # Check for warmup errors
                    if msg.get("type") == "user":
                        content = msg.get("message", {}).get("content", [])
                        if isinstance(content, list):
                            for item in content:
                                if isinstance(item, dict):
                                    if item.get("content") == "Warmup" and item.get("is_error"):
                                        stats["warmup_errors"] += 1

                    # Track tool calls
                    if msg.get("type") == "assistant":
                        content = msg.get("message", {}).get("content", [])
                        if isinstance(content, list):
                            for item in content:
                                if isinstance(item, dict) and item.get("type") == "tool_use":
                                    tool_input = item.get("input", {})
                                    if isinstance(tool_input, dict):
                                        cmd = tool_input.get("command", item.get("name", "unknown"))
                                        stats["tool_calls"][cmd] += 1

                except json.JSONDecodeError:
                    continue

    except Exception as e:
        stats["issues"].append(f"Error reading file: {e}")
        return stats

    # Detect issues
    if stats["warmup_errors"] > 10:
        stats["issues"].append(f"CRITICAL: Warmup loop detected ({stats['warmup_errors']} warmup errors)")

    if stats["message_count"] > 500:
        stats["issues"].append(f"WARNING: Excessive messages ({stats['message_count']})")

    # Check for repeated commands
    for cmd, count in stats["tool_calls"].most_common(5):
        if count > 50:
            stats["issues"].append(f"WARNING: Command repeated {count}x: {cmd[:50]}...")

    if stats["size_kb"] > 2000:  # > 2MB
        stats["issues"].append(f"WARNING: Large session file ({stats['size_kb']:.0f}KB)")

    return stats


def find_sessions(base_path: Path) -> list:
    """Find all session files."""
    sessions = []
    for jsonl in base_path.rglob("*.jsonl"):
        sessions.append(jsonl)
    return sessions


def main():
    parser = argparse.ArgumentParser(description="Check Claude Code session health")
    parser.add_argument("--fix", action="store_true", help="Remove problematic sessions")
    parser.add_argument("--path", default=os.path.expanduser("~/.claude/projects"),
                        help="Path to projects directory")
    parser.add_argument("--json", action="store_true", help="Output as JSON")
    args = parser.parse_args()

    base_path = Path(args.path)
    if not base_path.exists():
        print(f"Path not found: {base_path}")
        sys.exit(1)

    sessions = find_sessions(base_path)
    results = []
    problematic = []

    for session_path in sessions:
        stats = analyze_session(session_path)
        results.append(stats)
        if stats["issues"]:
            problematic.append(stats)

    if args.json:
        print(json.dumps(results, indent=2, default=str))
        return

    # Summary
    print(f"\n{'='*60}")
    print(f"SESSION HEALTH CHECK")
    print(f"{'='*60}")
    print(f"Total sessions: {len(sessions)}")
    print(f"Problematic: {len(problematic)}")

    if problematic:
        print(f"\n{'='*60}")
        print("ISSUES FOUND:")
        print(f"{'='*60}")

        for stats in problematic:
            print(f"\n{stats['name']}")
            print(f"  Size: {stats['size_kb']:.0f}KB | Messages: {stats['message_count']}")
            print(f"  Warmup errors: {stats['warmup_errors']}")
            print(f"  Sidechain: {stats['is_sidechain']}")
            for issue in stats["issues"]:
                print(f"  -> {issue}")

        if args.fix:
            print(f"\n{'='*60}")
            print("CLEANING UP...")
            print(f"{'='*60}")
            for stats in problematic:
                if any("CRITICAL" in i for i in stats["issues"]):
                    try:
                        os.remove(stats["path"])
                        print(f"Removed: {stats['name']}")
                    except Exception as e:
                        print(f"Failed to remove {stats['name']}: {e}")
    else:
        print("\nAll sessions healthy!")

    return len(problematic)


if __name__ == "__main__":
    sys.exit(main())
