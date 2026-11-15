#!/usr/bin/env python3
"""Load OKF publish redaction profiles and apply or scan their regex rules."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import re
from typing import Any

import yaml

PROFILE_FILENAME = "okf-publish.yaml"
PROFILE_VERSION = "0.1"
DEFAULT_REPLACE = "[redacted]"
RULE_ID = re.compile(r"^[a-z0-9][a-z0-9-]*$")
TOP_LEVEL_KEYS = ("okf_publish_version", "disable_default_rules", "rules", "private_strings")
RULE_KEYS = ("id", "pattern", "replace")

DEFAULT_RULES: tuple[tuple[str, str, str], ...] = (
    ("home-path-unix", r"/(?:home|Users)/[^/\s'\"`)\]>]+", "~"),
    ("home-path-windows", r"[A-Za-z]:\\Users\\[^\\\s'\"`)\]>]+", "~"),
    ("ipv4", r"\b(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}\b", "[ip]"),
    ("github-token", r"\bgh[pousr]_[A-Za-z0-9]{36,}\b", "[token]"),
    ("openai-style-key", r"\bsk-[A-Za-z0-9_-]{20,}", "[token]"),
    ("aws-access-key", r"\bAKIA[0-9A-Z]{16}\b", "[token]"),
    ("slack-token", r"\bxox[abprs]-[A-Za-z0-9-]{10,}", "[token]"),
    ("private-key-block", r"-----BEGIN [A-Z ]*PRIVATE KEY-----", "[private-key]"),
)
DEFAULT_RULE_IDS = tuple(rule_id for rule_id, _pattern, _replace in DEFAULT_RULES)


@dataclass(frozen=True)
class Rule:
    id: str
    pattern: re.Pattern[str]
    replace: str
    origin: str  # "default" | "profile" | "private_strings"


@dataclass(frozen=True)
class Profile:
    rules: tuple[Rule, ...]
    path: Path | None  # None when built-in rules only


def _default_rules(disabled: set[str] | frozenset[str] = frozenset()) -> list[Rule]:
    return [
        Rule(rule_id, re.compile(pattern), replace, "default")
        for rule_id, pattern, replace in DEFAULT_RULES
        if rule_id not in disabled
    ]


def default_profile() -> Profile:
    return Profile(rules=tuple(_default_rules()), path=None)


def _string_list(value: Any, field: str, errors: list[str]) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, list):
        errors.append(f"{field} must be a list.")
        return []
    items: list[str] = []
    for position, item in enumerate(value, start=1):
        if not isinstance(item, str):
            errors.append(f"{field} entry {position} must be a string.")
            continue
        items.append(item)
    return items


def _parse_rules(value: Any, errors: list[str]) -> list[Rule]:
    if value is None:
        return []
    if not isinstance(value, list):
        errors.append("rules must be a list.")
        return []
    rules: list[Rule] = []
    for position, entry in enumerate(value, start=1):
        label = f"rules entry {position}"
        if not isinstance(entry, dict):
            errors.append(f"{label} must be a mapping.")
            continue
        for key in sorted(str(key) for key in entry if key not in RULE_KEYS):
            errors.append(f"{label} has unknown key {key}.")
        rule_id = entry.get("id")
        pattern = entry.get("pattern")
        replace = entry.get("replace", DEFAULT_REPLACE)
        if rule_id is None:
            errors.append(f"{label} is missing id.")
            continue
        if not isinstance(rule_id, str):
            errors.append(f"{label} id must be a string.")
            continue
        if not RULE_ID.match(rule_id):
            errors.append(f"{label} id {rule_id!r} must match ^[a-z0-9][a-z0-9-]*$.")
            continue
        if pattern is None:
            errors.append(f"rule {rule_id} is missing pattern.")
            continue
        if not isinstance(pattern, str):
            errors.append(f"rule {rule_id} pattern must be a string.")
            continue
        if not isinstance(replace, str):
            errors.append(f"rule {rule_id} replace must be a string.")
            continue
        try:
            compiled = re.compile(pattern)
        except re.error as exc:
            errors.append(f"rule {rule_id} pattern does not compile: {exc}.")
            continue
        rules.append(Rule(rule_id, compiled, replace, "profile"))
    return rules


def _private_pattern(text: str) -> re.Pattern[str]:
    """Match ``text`` literally and case-insensitively; any whitespace run, including a line break, matches."""
    return re.compile(r"\s+".join(re.escape(word) for word in text.split()), re.IGNORECASE)


def _parse_profile(data: Any, path: Path) -> tuple[Profile | None, list[str]]:
    errors: list[str] = []
    if not isinstance(data, dict):
        return None, ["profile top level must be a mapping."]

    for key in sorted(str(key) for key in data if key not in TOP_LEVEL_KEYS):
        errors.append(f"unknown top-level key {key}.")

    if data.get("okf_publish_version") != PROFILE_VERSION:
        errors.append(f'okf_publish_version must be the string "{PROFILE_VERSION}".')

    disabled = _string_list(data.get("disable_default_rules"), "disable_default_rules", errors)
    for rule_id in disabled:
        if rule_id not in DEFAULT_RULE_IDS:
            errors.append(f"disable_default_rules names unknown built-in rule id {rule_id}.")

    profile_rules = _parse_rules(data.get("rules"), errors)

    private_rules: list[Rule] = []
    for position, text in enumerate(_string_list(data.get("private_strings"), "private_strings", errors), start=1):
        if not text.strip():
            errors.append(f"private_strings entry {position} must not be empty.")
            continue
        private_rules.append(
            Rule(f"private-string-{position}", _private_pattern(text), DEFAULT_REPLACE, "private_strings")
        )

    seen = set(DEFAULT_RULE_IDS) | {rule.id for rule in private_rules}
    for rule in profile_rules:
        if rule.id in seen:
            errors.append(f"rules id {rule.id} is a duplicate rule id.")
        seen.add(rule.id)

    if errors:
        return None, errors
    rules = _default_rules(set(disabled)) + profile_rules + private_rules
    return Profile(rules=tuple(rules), path=path), []


def load_profile(bundle_root: Path, profile_path: Path | None = None) -> tuple[Profile | None, list[str]]:
    """Load ``profile_path`` or ``<bundle>/okf-publish.yaml``; fall back to the built-in rules."""
    if profile_path is None:
        candidate = bundle_root / PROFILE_FILENAME
        if not candidate.exists():
            return default_profile(), []
        path = candidate
    else:
        path = profile_path
        if not path.is_file():
            return None, ["profile file not found."]
    try:
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError) as exc:
        return None, [f"profile cannot be read: {exc}."]
    except yaml.YAMLError as exc:
        problem = getattr(exc, "problem", None) or "parse error"
        return None, [f"profile is not valid YAML: {problem}."]
    return _parse_profile(data, path)


def _literal(replace: str) -> str:
    return replace.replace("\\", "\\\\")


def redact(text: str, profile: Profile) -> tuple[str, dict[str, int]]:
    """Apply every rule in order; return the new text and substitution counts by rule id."""
    counts: dict[str, int] = {}
    for rule in profile.rules:
        text, count = rule.pattern.subn(_literal(rule.replace), text)
        if count:
            counts[rule.id] = counts.get(rule.id, 0) + count
    return text, counts


def scan(text: str, profile: Profile) -> list[tuple[str, int]]:
    """Return sorted unique ``(rule_id, line)`` pairs for matches in ``text``; never the matched text."""
    hits: set[tuple[str, int]] = set()
    for rule in profile.rules:
        for match in rule.pattern.finditer(text):
            hits.add((rule.id, text.count("\n", 0, match.start()) + 1))
    return sorted(hits)
