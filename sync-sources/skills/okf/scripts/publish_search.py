#!/usr/bin/env python3
"""Write the client-side search index, search page and search script for a published site."""

from __future__ import annotations

import json
from pathlib import Path
import re

from publish_markdown import strip_links
from publish_model import PublishModel
from publish_render import concept_page_path, copy_asset, page_shell, relative_href, write_file

FENCE_LINE = re.compile(r"^ {0,3}(?:`{3,}|~{3,}).*$", re.MULTILINE)
FOOTNOTE_MARK = re.compile(r"\[\^[^\]\s]+\]:?")
WHITESPACE = re.compile(r"\s+")
SEARCH_BODY = '<h1>Search</h1><p id="okf-status"></p><ol id="okf-results"></ol>'


def search_text(body: str) -> str:
    """Return plain searchable text: no fence lines, link targets or footnote markers."""
    text = FENCE_LINE.sub("", body)
    text = strip_links(text)
    text = FOOTNOTE_MARK.sub("", text)
    return WHITESPACE.sub(" ", text).strip()


def search_records(model: PublishModel) -> list[dict[str, str]]:
    records = []
    for concept_id in model.public_ids():
        concept = model.concepts[concept_id]
        records.append(
            {
                "id": concept_id,
                "title": concept.title,
                "description": concept.description,
                "type": concept.type,
                "url": relative_href("search.html", concept_page_path(concept_id)),
                "text": search_text(concept.body),
            }
        )
    return records


def write_search(model: PublishModel, out_dir: Path, site_title: str) -> None:
    payload = json.dumps(search_records(model), sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    write_file(out_dir, "search-index.json", payload + "\n")
    page = page_shell(
        title="Search",
        site_title=site_title,
        page_path="search.html",
        body_html=SEARCH_BODY,
        scripts=("assets/search.js",),
    )
    write_file(out_dir, "search.html", page)
    copy_asset(out_dir, "search.js")
