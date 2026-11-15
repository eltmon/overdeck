#!/usr/bin/env python3
"""Build the publish model of an OKF bundle: walk, visibility, trust tier, links and backlinks."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

from okf_common import OkfError, concept_id_for_path, markdown_links, normalize_newlines, read_text, split_frontmatter

VISIBILITY_KEY = "x_visibility"
DEFAULT_KEY = "x_visibility_default"
SCHEMA_FILE = "schema.md"
VISIBILITY_VALUES = ("public", "private")
EXTERNAL_PREFIXES = ("http://", "https://", "mailto:")


@dataclass(frozen=True)
class LinkTarget:
    kind: str  # "concept" | "directory" | "external" | "fragment" | "other"
    value: str  # concept ID, directory path ("" = root), or the raw href
    fragment: str  # text after "#", without the "#"; "" when none


@dataclass(frozen=True)
class Source:
    title: str  # "" when absent
    resource: str  # required; entries without it are skipped
    author: str  # "" when absent


@dataclass(frozen=True)
class PublishConcept:
    concept_id: str
    path: str  # bundle-relative POSIX path, e.g. "rules/no-spoilers.md"
    directory: str  # "" for root
    title: str  # frontmatter title, else last ID segment
    description: str
    type: str
    tags: tuple[str, ...]
    status: str  # default "stable"
    trust_tier: str
    sources: tuple[Source, ...]
    body: str
    body_start_line: int  # 1-based file line of the first body line
    visibility: str  # "public" | "private"
    links: tuple[str, ...]  # raw link targets from markdown_links(body), in order


@dataclass(frozen=True)
class Finding:
    code: str
    location: str  # "rules/a.md", "rules/a.md:14", "index.md:5"
    message: str

    def line(self) -> str:
        return f"ERROR {self.code} {self.location}: {self.message}"


@dataclass
class PublishModel:
    bundle_root: Path
    default_visibility: str
    default_reason: str
    concepts: dict[str, PublishConcept]  # every parsed concept, keyed by ID
    index_files: dict[str, str]  # directory -> index.md text with any frontmatter removed
    index_offsets: dict[str, int] = field(default_factory=dict)  # directory -> frontmatter lines stripped

    _public_ids: list[str] | None = field(default=None, init=False, repr=False, compare=False)
    _public_dirs: frozenset[str] | None = field(default=None, init=False, repr=False, compare=False)
    _backlinks: dict[str, list[str]] | None = field(default=None, init=False, repr=False, compare=False)

    # The caches assume ``concepts`` is not mutated after the first query; build a new model
    # (for example with ``dataclasses.replace``) instead, which starts with empty caches.

    def public_ids(self) -> list[str]:
        if self._public_ids is None:
            self._public_ids = sorted(
                concept_id for concept_id, concept in self.concepts.items() if concept.visibility == "public"
            )
        return list(self._public_ids)

    def is_public(self, concept_id: str) -> bool:
        concept = self.concepts.get(concept_id)
        return concept is not None and concept.visibility == "public"

    def public_dirs(self) -> set[str]:
        if self._public_dirs is None:
            dirs = {""}
            for concept_id in self.public_ids():
                directory = self.concepts[concept_id].directory
                parts = directory.split("/") if directory else []
                for depth in range(1, len(parts) + 1):
                    dirs.add("/".join(parts[:depth]))
            self._public_dirs = frozenset(dirs)
        return set(self._public_dirs)

    def backlinks(self, concept_id: str) -> list[str]:
        if self._backlinks is None:
            reverse: dict[str, set[str]] = {}
            for source_id in self.public_ids():
                source = self.concepts[source_id]
                for link in source.links:
                    target = classify_link(source.directory, link)
                    if target.kind == "concept" and target.value != source_id:
                        reverse.setdefault(target.value, set()).add(source_id)
            self._backlinks = {target: sorted(sources) for target, sources in reverse.items()}
        return list(self._backlinks.get(concept_id, []))


def classify_link(source_dir: str, target: str) -> LinkTarget:
    """Classify a raw Markdown link target found on a page in ``source_dir`` (section 4.3)."""
    path, _, fragment = target.partition("#")
    if path == "":
        return LinkTarget("fragment", "#" + fragment, fragment)
    if path.lower().startswith(EXTERNAL_PREFIXES):
        return LinkTarget("external", target, fragment)
    if ":" in path:
        return LinkTarget("other", target, fragment)

    if path.startswith("/"):
        raw_parts = path[1:].split("/")
    else:
        raw_parts = (source_dir.split("/") if source_dir else []) + path.split("/")

    parts: list[str] = []
    for part in raw_parts:
        if part in ("", "."):
            continue
        if part == "..":
            if not parts:
                return LinkTarget("other", target, fragment)
            parts.pop()
            continue
        parts.append(part)

    last = path.rsplit("/", 1)[-1]
    if last in ("", ".", "..") or not parts:
        return LinkTarget("directory", "/".join(parts), fragment)
    name = parts[-1]
    if name == "index.md":
        return LinkTarget("directory", "/".join(parts[:-1]), fragment)
    if name == "log.md":
        return LinkTarget("other", target, fragment)
    if name.endswith(".md"):
        return LinkTarget("concept", "/".join(parts)[: -len(".md")], fragment)
    return LinkTarget("other", target, fragment)


def walk_markdown(bundle_root: Path, exclude: Path | None = None) -> list[Path]:
    """Return sorted ``*.md`` files, skipping dot-components, ``node_modules`` and ``exclude``."""
    root = bundle_root.resolve()
    excluded: Path | None = None
    if exclude is not None:
        candidate = exclude.resolve()
        if candidate != root and root in candidate.parents:
            excluded = candidate
    paths: list[Path] = []
    for path in root.rglob("*.md"):
        if not path.is_file():
            continue
        relative = path.relative_to(root)
        if any(part.startswith(".") or part == "node_modules" for part in relative.parts):
            continue
        if excluded is not None and (path == excluded or excluded in path.parents):
            continue
        paths.append(path)
    return sorted(paths, key=lambda item: item.relative_to(root).as_posix())


def trust_tier(frontmatter: dict) -> str:
    verified = frontmatter.get("verified")
    if verified is None:
        entries: list[Any] = []
    elif isinstance(verified, dict):
        entries = [verified]
    elif isinstance(verified, list):
        entries = [entry for entry in verified if isinstance(entry, dict)]
    else:
        entries = []
    if any(isinstance(entry.get("by"), str) and entry["by"].startswith("human:") for entry in entries):
        return "human-reviewed"
    if entries:
        return "machine-confirmed"
    return "unverified"


def _text(value: Any) -> str:
    return "" if value is None else str(value)


def _tags(value: Any) -> tuple[str, ...]:
    if value is None:
        return ()
    if isinstance(value, list):
        return tuple(str(item) for item in value)
    return (str(value),)


def _sources(value: Any) -> tuple[Source, ...]:
    if not isinstance(value, list):
        return ()
    sources: list[Source] = []
    for item in value:
        if isinstance(item, dict):
            if item.get("resource") is None:
                continue
            sources.append(Source(_text(item.get("title")), str(item["resource"]), _text(item.get("author"))))
        elif isinstance(item, str):
            sources.append(Source("", item, ""))
    return tuple(sources)


def _body_start_line(lines: list[str]) -> int:
    closing = next(index for index, line in enumerate(lines[1:], start=1) if line == "---")
    start = closing + 2
    if closing + 1 < len(lines) and lines[closing + 1] == "":
        start += 1
    return start


def _parse_error(exc: Exception) -> str:
    if isinstance(exc, yaml.YAMLError):
        problem = getattr(exc, "problem", None) or "invalid YAML"
        mark = getattr(exc, "problem_mark", None)
        where = f" (frontmatter line {mark.line + 1})" if mark is not None else ""
        return f"frontmatter does not parse: {problem}{where}"
    return str(exc)


def _strip_index_frontmatter(text: str) -> tuple[str, int]:
    if not text.startswith("---\n"):
        return text, 0
    lines = text.split("\n")
    for index, line in enumerate(lines[1:], start=1):
        if line == "---":
            return "\n".join(lines[index + 1 :]), index + 1
    return text, 0


def _bundle_default(root: Path, findings: list[Finding]) -> tuple[str, str]:
    schema = root / SCHEMA_FILE
    if not schema.is_file():
        return "private", f"no {SCHEMA_FILE} at bundle root"
    try:
        frontmatter, _body = split_frontmatter(read_text(schema))
    except (OkfError, yaml.YAMLError, UnicodeDecodeError):
        return "private", f"{SCHEMA_FILE} frontmatter does not parse"
    if DEFAULT_KEY not in frontmatter:
        return "private", f"{SCHEMA_FILE} has no {DEFAULT_KEY}"
    value = frontmatter[DEFAULT_KEY]
    if isinstance(value, str) and value in VISIBILITY_VALUES:
        return value, f"{SCHEMA_FILE} {DEFAULT_KEY}: {value}"
    findings.append(Finding("P_VISIBILITY_INVALID", SCHEMA_FILE, f"{DEFAULT_KEY} must be public or private"))
    return "private", f"{SCHEMA_FILE} {DEFAULT_KEY} is invalid"


def build_model(bundle_root: Path, exclude: Path | None = None) -> tuple[PublishModel, list[Finding]]:
    root = bundle_root.resolve()
    findings: list[Finding] = []
    default_visibility, default_reason = _bundle_default(root, findings)
    concepts: dict[str, PublishConcept] = {}
    index_files: dict[str, str] = {}
    index_offsets: dict[str, int] = {}

    for path in walk_markdown(root, exclude):
        relative = path.relative_to(root)
        rel = relative.as_posix()
        directory = "" if relative.parent.as_posix() == "." else relative.parent.as_posix()
        if relative.name == "log.md":
            continue
        try:
            text = normalize_newlines(read_text(path))
        except UnicodeDecodeError as exc:
            findings.append(Finding("P_FRONTMATTER_PARSE", rel, f"file is not UTF-8: {exc.reason}"))
            continue
        if relative.name == "index.md":
            index_files[directory], index_offsets[directory] = _strip_index_frontmatter(text)
            continue
        try:
            frontmatter, body = split_frontmatter(text)
        except (OkfError, yaml.YAMLError) as exc:
            findings.append(Finding("P_FRONTMATTER_PARSE", rel, _parse_error(exc)))
            continue

        concept_id = concept_id_for_path(relative)
        if VISIBILITY_KEY not in frontmatter:
            visibility = default_visibility
        else:
            value = frontmatter[VISIBILITY_KEY]
            if isinstance(value, str) and value in VISIBILITY_VALUES:
                visibility = value
            else:
                findings.append(Finding("P_VISIBILITY_INVALID", rel, f"{VISIBILITY_KEY} must be public or private"))
                visibility = "private"

        concepts[concept_id] = PublishConcept(
            concept_id=concept_id,
            path=rel,
            directory=directory,
            title=_text(frontmatter.get("title")) or concept_id.rsplit("/", 1)[-1],
            description=_text(frontmatter.get("description")),
            type=_text(frontmatter.get("type")),
            tags=_tags(frontmatter.get("tags")),
            status=_text(frontmatter.get("status")) or "stable",
            trust_tier=trust_tier(frontmatter),
            sources=_sources(frontmatter.get("sources")),
            body=body,
            body_start_line=_body_start_line(text.split("\n")),
            visibility=visibility,
            links=tuple(markdown_links(body)),
        )

    model = PublishModel(
        bundle_root=root,
        default_visibility=default_visibility,
        default_reason=default_reason,
        concepts=concepts,
        index_files=index_files,
        index_offsets=index_offsets,
    )
    return model, findings
