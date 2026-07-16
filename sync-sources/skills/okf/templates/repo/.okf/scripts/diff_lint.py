#!/usr/bin/env python3
"""Compare OKF validation findings and fail only on newly introduced breakage."""

from __future__ import annotations

import argparse
from pathlib import Path

from validate import ERROR, Finding, validate_bundle


def finding_map(bundle: Path) -> dict[str, Finding]:
    return {finding.key(): finding for finding in validate_bundle(bundle)}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Compare OKF validation findings between base and head")
    parser.add_argument("--base", required=True, help="base bundle directory")
    parser.add_argument("--head", required=True, help="head bundle directory")
    args = parser.parse_args(argv)

    base = finding_map(Path(args.base).resolve())
    head = finding_map(Path(args.head).resolve())
    new_findings = [finding for key, finding in sorted(head.items()) if key not in base]

    for finding in new_findings:
        print(f"NEW {finding.line()}")

    if any(finding.tier == ERROR for finding in new_findings):
        return 2
    if new_findings:
        return 1
    print("ok - no new validation findings")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
