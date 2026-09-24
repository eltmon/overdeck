#!/usr/bin/env python3
"""Preserve JSONL history with permanent Restic snapshots, without moving sources.

Run `configure` once, then `backup` on a timer. No command expires snapshots.
Python 3 and Restic >= 0.16 are required. See docs/TRANSCRIPT-PRESERVATION.md.
"""

import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
import tempfile


# Claude rejects zero. This prevents its normal age-based cleanup for 1,000
# years; permanent snapshots provide preservation independent of that setting.
RETENTION_DAYS = 365000
SKIP_DIRS = {"node_modules", ".git", "plugins", "skills"}


def walk_files(root):
    def on_error(error):
        raise error

    if not root.exists():
        return
    for directory, dirs, files in os.walk(root, onerror=on_error):
        dirs[:] = [name for name in dirs if name not in SKIP_DIRS]
        for name in files:
            path = Path(directory) / name
            if not path.is_symlink():
                yield path


def atomic_write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as output:
        temporary = Path(output.name)
        try:
            output.write(data)
            output.flush()
            os.fsync(output.fileno())
            os.replace(temporary, path)
        finally:
            temporary.unlink(missing_ok=True)


def protect_settings(path, backup_dir):
    path = path.resolve()
    original = path.read_bytes() if path.exists() else b"{}"
    settings = json.loads(original)
    if not isinstance(settings, dict):
        raise ValueError(f"{path}: expected a JSON object; refusing to overwrite")
    existing = settings.get("cleanupPeriodDays")
    if isinstance(existing, int) and existing >= RETENTION_DAYS:
        return False
    # Preserve the exact original, including unrelated settings and credentials.
    digest = hashlib.sha256(str(path).encode() + b"\0" + original).hexdigest()
    backup = backup_dir / (digest + ".json")
    if not backup.exists():
        atomic_write(backup, original)
        atomic_write(backup.with_suffix(".path"), (str(path) + "\n").encode())
    settings["cleanupPeriodDays"] = RETENTION_DAYS
    if path.exists() and path.read_bytes() != original:
        raise RuntimeError(f"{path} changed during retention update; retry")
    atomic_write(path, (json.dumps(settings, indent=2) + "\n").encode())
    return True


def configure(home, overdeck, storage):
    settings = {home / ".claude/settings.json", overdeck / "harnesses/claude/settings.json"}
    # Launch homes already running retain their own settings. Future managed
    # homes inherit the canonical settings above. Never touch another harness.
    for path in walk_files(overdeck / "agents"):
        if path.name == "settings.json" and any("claude" in part for part in path.relative_to(overdeck / "agents").parts[:-1]):
            settings.add(path)
    changed = sum(protect_settings(path, storage / "settings-backups") for path in sorted(settings))
    print(json.dumps({"settingsChecked": len(settings), "settingsChanged": changed}), flush=True)


def restic(storage, *arguments, **kwargs):
    # Do not inherit another backup job's repository, password, or exclusions.
    env = {key: value for key, value in os.environ.items() if not key.startswith("RESTIC_")}
    return subprocess.run([
        "restic", "--repo", str(storage / "repository"),
        "--password-file", str(storage / "password"),
        "--cache-dir", str(storage / "cache"), *arguments,
    ], env=env, check=True, **kwargs)


def initialize(storage):
    repository = storage / "repository"
    password = storage / "password"
    if not password.exists():
        if repository.exists():
            raise RuntimeError("Archive password is missing; restore it before continuing")
        with open(password, "x", opener=lambda path, flags: os.open(path, flags, 0o600)) as output:
            output.write(secrets.token_hex(32) + "\n")
    if not (repository / "config").exists():
        restic(storage, "init", "--repository-version", "2")


def backup(home, overdeck, storage):
    initialize(storage)
    roots = [home / ".claude/projects", home / ".codex/sessions",
             home / ".codex/archived_sessions", overdeck / "agents",
             overdeck / "harnesses/claude/projects"]
    # A raw NUL-delimited list handles spaces, newlines, and leading '#' safely.
    with tempfile.NamedTemporaryFile(dir=storage) as inventory:
        count = 0
        for root in roots:
            for path in walk_files(root):
                if path.suffix == ".jsonl":
                    inventory.write(os.fsencode(path) + b"\0")
                    count += 1
        inventory.flush()
        if not count:
            raise RuntimeError("No JSONL transcripts found; refusing an empty backup")
        print(json.dumps({"transcriptsFound": count}), flush=True)
        # Group by host and tag so added/removed source files do not prevent
        # incremental reuse. Restic retains old snapshots after source deletion
        # or truncation. Exit 3 (incomplete backup) remains a visible failure.
        restic(storage, "backup", "--files-from-raw", inventory.name,
               "--tag", "overdeck-transcripts", "--group-by", "host,tags", "--json", "--quiet")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["configure", "backup"])
    parser.add_argument("--home", type=Path, default=Path.home())
    parser.add_argument("--overdeck-home", type=Path)
    args = parser.parse_args()
    home = args.home.resolve()
    overdeck = (args.overdeck_home or home / ".overdeck").resolve()
    storage = overdeck / "transcript-preservation"
    storage.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.umask(0o077)
    with (storage / "lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        settings_error = None
        try:
            configure(home, overdeck, storage)
        except Exception as error:
            if args.command == "configure":
                raise
            settings_error = error
            print(f"Retention settings failed; still backing up transcripts: {error}", file=sys.stderr)
        if args.command == "backup":
            backup(home, overdeck, storage)
        if settings_error:
            raise settings_error


if __name__ == "__main__":
    main()
