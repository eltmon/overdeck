#!/usr/bin/env python3
"""Regenerate marker-delimited OKF index sections and append log entries."""

from __future__ import annotations

import argparse
from datetime import date
from pathlib import Path
import sys

from okf_common import iter_concept_paths, parse_concept


BEGIN = "<!-- OKF:INDEX:BEGIN -->"
END = "<!-- OKF:INDEX:END -->"


def relative_link(from_dir: Path, target: Path) -> str:
    return target.relative_to(from_dir).as_posix() if target.is_relative_to(from_dir) else target.as_posix()


def listing_for_directory(bundle_root: Path, directory: Path) -> str:
    lines: list[str] = []
    child_dirs = sorted(path for path in directory.iterdir() if path.is_dir() and path.name not in {".okf-index", ".git"})
    child_concepts = sorted(path for path in directory.glob("*.md") if path.name not in {"index.md", "log.md"})

    for child in child_dirs:
        lines.append(f"* [{child.name}/]({child.name}/) - Subdirectory")

    for concept_path in child_concepts:
        concept = parse_concept(concept_path, bundle_root)
        title = str(concept.frontmatter.get("title") or concept.concept_id.rsplit("/", 1)[-1])
        description = str(concept.frontmatter.get("description") or "")
        suffix = f" - {description}" if description else ""
        lines.append(f"* [{title}]({concept_path.name}){suffix}")

    return "\n".join(lines) + ("\n" if lines else "")


def replace_marked_section(existing: str, generated: str) -> str:
    if BEGIN in existing and END in existing:
        before, rest = existing.split(BEGIN, 1)
        _old, after = rest.split(END, 1)
        return f"{before}{BEGIN}\n{generated}{END}{after}"
    if existing and not existing.endswith("\n"):
        existing += "\n"
    return f"{existing}{BEGIN}\n{generated}{END}\n"


def reindex_directory(bundle_root: Path, directory: Path) -> bool:
    index_path = directory / "index.md"
    existing = index_path.read_text(encoding="utf-8") if index_path.exists() else "# Index\n\n"
    generated = listing_for_directory(bundle_root, directory)
    updated = replace_marked_section(existing, generated)
    if updated != existing:
        index_path.write_text(updated, encoding="utf-8")
        return True
    return False


def directories_to_index(bundle_root: Path) -> list[Path]:
    directories = {bundle_root}
    for concept_path in iter_concept_paths(bundle_root):
        directories.add(concept_path.parent)
    return sorted(directories)


def append_log_entry(bundle_root: Path, entry: str, entry_date: str | None = None) -> None:
    day = entry_date or date.today().isoformat()
    log_path = bundle_root / "log.md"
    existing = log_path.read_text(encoding="utf-8") if log_path.exists() else "# Directory Update Log\n"
    if not existing.endswith("\n"):
        existing += "\n"

    heading = f"## {day}"
    line = f"* {entry}"
    if heading in existing:
        before, rest = existing.split(heading, 1)
        if rest.startswith("\n"):
            rest = rest[1:]
        updated = f"{before}{heading}\n{line}\n{rest}"
    else:
        title, _, remainder = existing.partition("\n")
        updated = f"{title}\n\n{heading}\n{line}\n"
        if remainder.strip():
            updated += f"\n{remainder.lstrip()}"
    log_path.write_text(updated, encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Regenerate OKF index sections and append log entries")
    parser.add_argument("--bundle", default=".", help="bundle root")
    parser.add_argument("--log-entry", help="append a log entry to bundle root log.md")
    parser.add_argument("--date", help="YYYY-MM-DD date for --log-entry")
    args = parser.parse_args(argv)

    bundle_root = Path(args.bundle).resolve()
    changed = 0
    for directory in directories_to_index(bundle_root):
        changed += 1 if reindex_directory(bundle_root, directory) else 0
    if args.log_entry:
        append_log_entry(bundle_root, args.log_entry, args.date)
    print(f"ok - reindexed {changed} index file(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
