"""
Caveman Compression Validator

Checks that a compressed file preserves all URLs, code blocks, and headings
from the original. Returns a ValidationResult with is_valid and errors list.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import List


@dataclass
class ValidationResult:
    is_valid: bool
    errors: List[str] = field(default_factory=list)


_URL_RE = re.compile(r"https?://[^\s\)\"']+")
_CODE_BLOCK_RE = re.compile(r"```[\s\S]*?```", re.MULTILINE)
_HEADING_RE = re.compile(r"^#{1,6} .+", re.MULTILINE)


def _extract_urls(text: str) -> List[str]:
    return _URL_RE.findall(text)


def _extract_code_blocks(text: str) -> List[str]:
    return _CODE_BLOCK_RE.findall(text)


def _extract_headings(text: str) -> List[str]:
    return _HEADING_RE.findall(text)


def validate(original_path: Path, compressed_path: Path) -> ValidationResult:
    """
    Validate that the compressed file preserves all URLs, code blocks, and
    headings from the original.

    Args:
        original_path: Path to the original (backup) file.
        compressed_path: Path to the compressed file to validate.

    Returns:
        ValidationResult with is_valid=True if all checks pass.
    """
    original = original_path.read_text(errors="ignore")
    compressed = compressed_path.read_text(errors="ignore")

    errors: List[str] = []

    # Check URLs
    orig_urls = set(_extract_urls(original))
    comp_urls = set(_extract_urls(compressed))
    for url in orig_urls - comp_urls:
        errors.append(f"Missing URL: {url}")

    # Check code blocks (by content, not position)
    orig_blocks = set(_extract_code_blocks(original))
    comp_blocks = set(_extract_code_blocks(compressed))
    for block in orig_blocks - comp_blocks:
        preview = block[:80].replace("\n", "\\n")
        errors.append(f"Missing code block: {preview}...")

    # Check headings
    orig_headings = set(_extract_headings(original))
    comp_headings = set(_extract_headings(compressed))
    for heading in orig_headings - comp_headings:
        errors.append(f"Missing heading: {heading}")

    return ValidationResult(is_valid=len(errors) == 0, errors=errors)
