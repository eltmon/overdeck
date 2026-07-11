#!/usr/bin/env python3
"""Deterministic OKF conformance and lint gate."""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path
import sys

from okf_common import OkfError, markdown_links, parse_concept, resolve_concept_link, split_frontmatter
from reindex import BEGIN, END, listing_for_directory


ERROR = "ERROR"
LINT = "LINT"


@dataclass(frozen=True)
class Finding:
    tier: str
    code: str
    path: str
    message: str

    def key(self) -> str:
        return f"{self.tier}:{self.code}:{self.path}:{self.message}"

    def line(self) -> str:
        return f"{self.tier} {self.code} {self.path}: {self.message}"


def has_frontmatter(text: str) -> bool:
    try:
        split_frontmatter(text)
        return True
    except OkfError:
        return False


def validate_reserved(path: Path, bundle_root: Path) -> list[Finding]:
    findings: list[Finding] = []
    relative = path.relative_to(bundle_root).as_posix()
    text = path.read_text(encoding="utf-8")
    if path.name == "log.md" and has_frontmatter(text):
        findings.append(Finding(ERROR, "E_RESERVED_FRONTMATTER", relative, "log.md must not have frontmatter"))
    if path.name == "index.md" and has_frontmatter(text):
        frontmatter, _body = split_frontmatter(text)
        if path.parent != bundle_root or set(frontmatter) != {"okf_version"}:
            findings.append(Finding(ERROR, "E_RESERVED_FRONTMATTER", relative, "index.md frontmatter is only allowed at bundle root for okf_version"))
    if path.name == "index.md" and BEGIN in text and END in text:
        before, rest = text.split(BEGIN, 1)
        current, _after = rest.split(END, 1)
        expected = "\n" + listing_for_directory(bundle_root, path.parent)
        if current != expected:
            findings.append(Finding(LINT, "L_INDEX_STALE", relative, "marker-delimited index section is stale"))
    return findings


def validate_concept(path: Path, bundle_root: Path) -> list[Finding]:
    findings: list[Finding] = []
    relative = path.relative_to(bundle_root).as_posix()
    try:
        concept = parse_concept(path, bundle_root)
    except OkfError as error:
        return [Finding(ERROR, "E_FRONTMATTER_PARSE", relative, str(error))]

    concept_type = concept.frontmatter.get("type")
    if "type" not in concept.frontmatter:
        findings.append(Finding(ERROR, "E_TYPE_MISSING", relative, "missing required type frontmatter field"))
    elif concept_type in ("", None):
        findings.append(Finding(ERROR, "E_TYPE_EMPTY", relative, "type frontmatter field is empty"))

    if not concept.frontmatter.get("description"):
        findings.append(Finding(LINT, "L_DESCRIPTION_MISSING", relative, "missing recommended description"))

    for link in markdown_links(concept.body):
        target = resolve_concept_link(path, link, bundle_root)
        if target is None:
            continue
        if not (bundle_root / f"{target}.md").exists():
            findings.append(Finding(LINT, "L_BROKEN_LINK", relative, f"broken link to {target}"))

    return findings


def validate_bundle(bundle_root: Path) -> list[Finding]:
    findings: list[Finding] = []
    for path in sorted(bundle_root.rglob("*.md")):
        if ".okf-index" in path.parts:
            continue
        if path.name in {"index.md", "log.md"}:
            findings.extend(validate_reserved(path, bundle_root))
        else:
            findings.extend(validate_concept(path, bundle_root))
    return findings


def exit_code(findings: list[Finding], strict: bool) -> int:
    has_errors = any(finding.tier == ERROR for finding in findings)
    has_lints = any(finding.tier == LINT for finding in findings)
    if has_errors or (strict and has_lints):
        return 2
    if has_lints:
        return 1
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Validate an OKF bundle")
    parser.add_argument("--bundle", default=".", help="bundle root")
    parser.add_argument("--strict", action="store_true", help="treat lint findings as failure")
    parser.add_argument("--json", action="store_true", help="emit JSON findings")
    args = parser.parse_args(argv)

    findings = validate_bundle(Path(args.bundle).resolve())
    if args.json:
        import json

        print(json.dumps([finding.__dict__ for finding in findings], sort_keys=True))
    else:
        for finding in findings:
            print(finding.line())
        if not findings:
            print("ok - bundle is conformant")
    return exit_code(findings, args.strict)


if __name__ == "__main__":
    raise SystemExit(main())
