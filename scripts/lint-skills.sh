#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

python3 - <<'PY'
from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path.cwd()
DOC = ROOT / "docs" / "SKILLS-CONVENTION.md"
SKILLS = ROOT / "skills"


def run_pan(*args: str) -> str:
    return subprocess.run(
        ["pan", *args],
        cwd=ROOT,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        check=True,
    ).stdout


def command_names(help_text: str) -> set[str]:
    names: set[str] = set()
    in_commands = False
    for line in help_text.splitlines():
        if line.strip() == "Commands:":
            in_commands = True
            continue
        if not in_commands:
            continue
        match = re.match(r"^  ([a-z][a-z0-9-]*)(?:\s|\[|<|$)", line)
        if match:
            names.add(match.group(1))
    return names


def option_names(help_text: str) -> set[str]:
    opts = set(re.findall(r"(?<![\w-])--[A-Za-z0-9][A-Za-z0-9-]*", help_text))
    opts.update(re.findall(r"(?<![\w-])-[A-Za-z](?![\w-])", help_text))
    return opts | {"--help", "-h"}


def excluded_verbs() -> set[str]:
    text = DOC.read_text()
    section = text.split("Verbs that **don't** get wrapped", 1)[1].split("## Linting", 1)[0]
    excluded: set[str] = set()
    for line in section.splitlines():
        if not line.startswith("|") or "---" in line:
            continue
        cells = line.split("|")
        if len(cells) < 3 or "`pan" not in cells[1]:
            continue
        excluded.update(re.findall(r"`pan\s+([a-z][a-z0-9-]*)`", cells[1]))
    return excluded


def extract_commands(text: str, verb: str) -> list[tuple[int, str]]:
    commands: list[tuple[int, str]] = []
    pattern = re.compile(rf"\bpan\s+{re.escape(verb)}\b[^`\n]*")
    in_fence = False
    for line_no, line in enumerate(text.splitlines(), start=1):
        stripped = line.strip()
        if stripped.startswith("```"):
            in_fence = not in_fence
            continue
        if stripped.startswith("#") or "coming soon" in line.lower() or "not yet shipped" in line.lower():
            continue
        candidates = [line] if in_fence else re.findall(r"`([^`]*\bpan\s+" + re.escape(verb) + r"\b[^`]*)`", line)
        for candidate in candidates:
            for match in pattern.finditer(candidate):
                cmd = match.group(0).strip()
                cmd = re.split(r"\s+(?:&&|\|\||\||;)\s*", cmd, maxsplit=1)[0]
                commands.append((line_no, cmd.rstrip(".,)")))
    return commands


def split_tokens(command: str) -> list[str]:
    return [token.strip("'\"`,") for token in command.split() if token.strip("'\"`,")]


def validate_command(
    skill: Path,
    line_no: int,
    command: str,
    verb: str,
    verb_flags: set[str],
    subcommands: set[str],
    global_flags: set[str],
) -> list[str]:
    tokens = split_tokens(command)
    errors: list[str] = []
    if len(tokens) < 2:
        return errors

    first_arg: str | None = None
    for token in tokens[2:]:
        if not token.startswith("-") and not token.startswith("$") and not token.startswith("<"):
            first_arg = token
            break

    if first_arg and subcommands and first_arg in subcommands and first_arg != "help":
        try:
            sub_help = run_pan(verb, first_arg, "--help")
        except subprocess.CalledProcessError:
            errors.append(f"{skill}:{line_no}: {command}: could not read help for pan {verb} {first_arg}")
            return errors
        flags = option_names(sub_help) | global_flags
        flag_tokens = tokens[3:]
    else:
        flags = set(verb_flags) | set(global_flags)
        flag_tokens = tokens[2:]

    for token in flag_tokens:
        if token.startswith("-"):
            flag = token.split("=", 1)[0]
            if flag not in flags:
                target = f"pan {verb} {first_arg}" if first_arg in subcommands else f"pan {verb}"
                errors.append(f"{skill}:{line_no}: {command}: unknown flag {flag!r} for {target}")

    if first_arg and subcommands and first_arg not in subcommands and not first_arg.startswith("--"):
        usage = next((line for line in run_pan(verb, "--help").splitlines() if line.startswith("Usage:")), "")
        if "[command]" in usage and "<" not in usage:
            errors.append(
                f"{skill}:{line_no}: {command}: unknown subcommand {first_arg!r} for pan {verb}"
            )

    return errors


def main() -> int:
    pan_help = run_pan("--help")
    top_commands = command_names(pan_help)
    global_flags = option_names(pan_help)
    exclusions = excluded_verbs()
    errors: list[str] = []

    for skill_md in sorted(SKILLS.glob("pan-*/SKILL.md")):
        skill_name = skill_md.parent.name.removeprefix("pan-")
        if skill_name == "help" or skill_name not in top_commands or skill_name in exclusions:
            continue

        try:
            help_text = run_pan(skill_name, "--help")
        except subprocess.CalledProcessError:
            errors.append(f"{skill_md}: pan {skill_name} exists in top-level help but --help failed")
            continue

        flags = option_names(help_text)
        subcommands = command_names(help_text)
        text = skill_md.read_text()
        for line_no, command in extract_commands(text, skill_name):
            errors.extend(
                validate_command(skill_md, line_no, command, skill_name, flags, subcommands, global_flags)
            )

    if errors:
        print("skill CLI lint failed:", file=sys.stderr)
        for error in errors:
            print(f"  {error}", file=sys.stderr)
        return 1

    print("skill CLI lint passed")
    return 0


raise SystemExit(main())
PY
