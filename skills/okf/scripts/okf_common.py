#!/usr/bin/env python3
"""Shared OKF parsing, linking, and hashing helpers."""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
from pathlib import Path, PurePosixPath
import re
from typing import Any, Iterable

import yaml


RESERVED_FILENAMES = {"index.md", "log.md"}
FRONTMATTER_DELIMITER = "---"
LINK_PATTERN = re.compile(r"(?<!!)\[[^\]]+\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)")


class OkfError(ValueError):
    """Raised when an OKF document cannot be parsed."""


@dataclass(frozen=True)
class ConceptDocument:
    path: Path
    concept_id: str
    frontmatter: dict[str, Any]
    body: str


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def normalize_newlines(text: str) -> str:
    return text.replace("\r\n", "\n").replace("\r", "\n")


def strip_trailing_space(text: str) -> str:
    return "\n".join(line.rstrip() for line in normalize_newlines(text).split("\n")).rstrip() + "\n"


def split_frontmatter(text: str) -> tuple[dict[str, Any], str]:
    normalized = normalize_newlines(text)
    lines = normalized.split("\n")
    if not lines or lines[0] != FRONTMATTER_DELIMITER:
        raise OkfError("concept is missing YAML frontmatter")

    closing_index = None
    for index, line in enumerate(lines[1:], start=1):
        if line == FRONTMATTER_DELIMITER:
            closing_index = index
            break

    if closing_index is None:
        raise OkfError("concept frontmatter is missing closing delimiter")

    raw_frontmatter = "\n".join(lines[1:closing_index])
    parsed = yaml.safe_load(raw_frontmatter) if raw_frontmatter.strip() else {}
    if not isinstance(parsed, dict):
        raise OkfError("concept frontmatter must be a mapping")

    body = "\n".join(lines[closing_index + 1 :])
    if body.startswith("\n"):
        body = body[1:]
    return parsed, body


def dump_frontmatter(frontmatter: dict[str, Any]) -> str:
    return yaml.safe_dump(frontmatter, sort_keys=False, allow_unicode=True).strip()


def serialize_concept(frontmatter: dict[str, Any], body: str) -> str:
    return f"{FRONTMATTER_DELIMITER}\n{dump_frontmatter(frontmatter)}\n{FRONTMATTER_DELIMITER}\n\n{normalize_newlines(body).lstrip()}"


def concept_id_for_path(path: Path, bundle_root: Path | None = None) -> str:
    relative = path if bundle_root is None else path.relative_to(bundle_root)
    if relative.name in RESERVED_FILENAMES:
        raise OkfError(f"{relative.as_posix()} is a reserved OKF filename")
    if relative.suffix != ".md":
        raise OkfError(f"{relative.as_posix()} is not a markdown concept")
    return relative.with_suffix("").as_posix()


def parse_concept(path: Path, bundle_root: Path | None = None) -> ConceptDocument:
    frontmatter, body = split_frontmatter(read_text(path))
    return ConceptDocument(
        path=path,
        concept_id=concept_id_for_path(path, bundle_root),
        frontmatter=frontmatter,
        body=body,
    )


def _body_without_fenced_code(body: str) -> str:
    output: list[str] = []
    in_fence = False
    for line in normalize_newlines(body).split("\n"):
        if line.startswith("```") or line.startswith("~~~"):
            in_fence = not in_fence
            output.append("")
            continue
        output.append("" if in_fence else line)
    return "\n".join(output)


def markdown_links(body: str) -> list[str]:
    searchable = _body_without_fenced_code(body)
    return [match.group(1).split("#", 1)[0] for match in LINK_PATTERN.finditer(searchable)]


def _is_external_link(target: str) -> bool:
    lowered = target.lower()
    return (
        lowered.startswith("http://")
        or lowered.startswith("https://")
        or lowered.startswith("mailto:")
        or lowered.startswith("tel:")
        or target.startswith("#")
        or target == ""
    )


def resolve_concept_link(source_path: Path, target: str, bundle_root: Path) -> str | None:
    clean_target = target.split("#", 1)[0]
    if _is_external_link(clean_target):
        return None

    if clean_target.startswith("/"):
        candidate = PurePosixPath(clean_target[1:])
    else:
        source_relative = source_path.relative_to(bundle_root)
        candidate = PurePosixPath(source_relative.parent.as_posix()) / clean_target

    normalized_parts: list[str] = []
    for part in candidate.parts:
        if part in ("", "."):
            continue
        if part == "..":
            if normalized_parts:
                normalized_parts.pop()
            continue
        normalized_parts.append(part)

    normalized = PurePosixPath(*normalized_parts)
    if normalized.suffix != ".md":
        return None
    if normalized.name in RESERVED_FILENAMES:
        return None
    return normalized.with_suffix("").as_posix()


def resolved_concept_links(source_path: Path, body: str, bundle_root: Path) -> list[str]:
    return [
        concept_id
        for concept_id in (resolve_concept_link(source_path, link, bundle_root) for link in markdown_links(body))
        if concept_id is not None
    ]


def normalized_content(frontmatter: dict[str, Any], body: str) -> str:
    stable_frontmatter = {key: value for key, value in frontmatter.items() if key != "timestamp"}
    dumped = yaml.safe_dump(stable_frontmatter, sort_keys=True, allow_unicode=True).strip()
    return strip_trailing_space(f"{dumped}\n\n{body}")


def normalized_content_hash(frontmatter: dict[str, Any], body: str) -> str:
    digest = hashlib.sha256(normalized_content(frontmatter, body).encode("utf-8")).hexdigest()
    return f"sha256:{digest}"


def iter_concept_paths(bundle_root: Path) -> Iterable[Path]:
    for path in sorted(bundle_root.rglob("*.md")):
        if path.name not in RESERVED_FILENAMES:
            yield path
