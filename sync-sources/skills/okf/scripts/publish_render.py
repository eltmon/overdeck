#!/usr/bin/env python3
"""Render published OKF concept pages, index pages and the site stylesheet."""

from __future__ import annotations

from pathlib import Path
import re
from urllib.parse import quote

from publish_markdown import LinkResolver, escape, find_links, render_markdown, safe_href
from publish_model import PublishConcept, PublishModel, classify_link

ASSETS_DIR = Path(__file__).resolve().parent / "publish_assets"
DEFAULT_SITE_TITLE = "Knowledge"
INDEX_MARKERS = ("<!-- OKF:INDEX:BEGIN -->", "<!-- OKF:INDEX:END -->")
LISTING_LINE = re.compile(r"^\s*[*-] ")
STATUS_CLASS = re.compile(r"^[a-z0-9-]+$")
MARKDOWN_SPECIALS = re.compile(r"([\\`*_\[\]])")


def concept_page_path(concept_id: str) -> str:
    return f"{concept_id}.html"


def dir_index_path(directory: str) -> str:
    return "index.html" if directory == "" else f"{directory}/index.html"


def relative_href(from_page: str, to_page: str) -> str:
    """Return a page-relative href from ``from_page`` to ``to_page`` (both site-root relative)."""
    from_dir = from_page.split("/")[:-1]
    to_parts = to_page.split("/")
    to_dir, name = to_parts[:-1], to_parts[-1]
    common = 0
    while common < len(from_dir) and common < len(to_dir) and from_dir[common] == to_dir[common]:
        common += 1
    segments = to_dir[common:] + [name]
    return "../" * (len(from_dir) - common) + "/".join(quote(segment, safe="") for segment in segments)


def make_resolver(model: PublishModel, source_dir: str, page_path: str) -> LinkResolver:
    public_dirs = model.public_dirs()

    def resolve(raw_target: str) -> str | None:
        target = classify_link(source_dir, raw_target)
        if target.kind == "concept" and model.is_public(target.value):
            href = relative_href(page_path, concept_page_path(target.value))
            return f"{href}#{target.fragment}" if target.fragment else href
        if target.kind == "directory" and target.value in public_dirs:
            return relative_href(page_path, dir_index_path(target.value))
        if target.kind in ("external", "fragment"):
            return target.value
        return None

    return resolve


def _first_link_target(line: str) -> str | None:
    links = [span for span in find_links(line) if not span.is_image]
    return links[0].target if links else None


def _links_to_published(target: str | None, directory: str, model: PublishModel) -> bool:
    if target is None:
        return False
    link = classify_link(directory, target)
    if link.kind == "concept":
        return model.is_public(link.value)
    if link.kind == "directory":
        return link.value in model.public_dirs()
    return False


def _links_to_unpublished(target: str | None, directory: str, model: PublishModel) -> bool:
    if target is None:
        return False
    link = classify_link(directory, target)
    if link.kind == "concept":
        return not model.is_public(link.value)
    if link.kind == "directory":
        return link.value not in model.public_dirs()
    return False


def kept_index_lines(text: str, directory: str, model: PublishModel) -> list[tuple[int, str]]:
    """Return ``(1-based line, line)`` pairs that survive index filtering.

    Inside the generated ``OKF:INDEX`` block, a line survives only when it is a listing line whose
    first link resolves to a public concept or a published directory; everything else there
    (private entries, continuation lines of multi-line descriptions, lines whose link does not
    parse) is dropped, so the block fails closed. Outside the block, hand-written listing lines
    whose first link points at an unpublished target are dropped and all other lines are kept.
    """
    kept: list[tuple[int, str]] = []
    in_block = False
    for number, line in enumerate(text.split("\n"), start=1):
        stripped = line.strip()
        if stripped == INDEX_MARKERS[0]:
            in_block = True
            kept.append((number, line))
            continue
        if stripped == INDEX_MARKERS[1]:
            in_block = False
            kept.append((number, line))
            continue
        is_listing = LISTING_LINE.match(line) is not None
        if in_block:
            if not stripped:
                kept.append((number, line))
            elif is_listing and _links_to_published(_first_link_target(line), directory, model):
                kept.append((number, line))
            continue
        if is_listing and _links_to_unpublished(_first_link_target(line), directory, model):
            continue
        kept.append((number, line))
    return kept


def filter_index_markdown(text: str, directory: str, model: PublishModel) -> str:
    return "\n".join(line for _number, line in kept_index_lines(text, directory, model))


def first_heading(text: str) -> str:
    for line in text.split("\n"):
        if line.startswith("# "):
            return line[2:].strip()
    return ""


def site_title(index_texts: dict[str, str]) -> str:
    return first_heading(index_texts.get("", "")) or DEFAULT_SITE_TITLE


def page_shell(
    *, title: str, site_title: str, page_path: str, body_html: str, scripts: tuple[str, ...] = ()
) -> str:
    rel = "../" * page_path.count("/")
    lines = [
        "<!doctype html>",
        '<html lang="en">',
        "<head>",
        '<meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1">',
        f"<title>{escape(title)} · {escape(site_title)}</title>",
        f'<link rel="stylesheet" href="{rel}assets/style.css">',
        "</head>",
        "<body>",
        f'<header class="site"><a class="home" href="{rel}index.html">{escape(site_title)}</a>',
        f'<form class="search" action="{rel}search.html" method="get" role="search">'
        '<input type="search" name="q" placeholder="Search" aria-label="Search"></form>',
        "</header>",
        "<main>",
        body_html,
        "</main>",
        '<footer class="site">Published from an Open Knowledge Format bundle.</footer>',
    ]
    lines.extend(f'<script src="{rel}{escape(path)}"></script>' for path in scripts)
    lines.extend(["</body>", "</html>"])
    return "\n".join(lines) + "\n"


def _status_class(status: str) -> str:
    lowered = status.lower()
    return lowered if STATUS_CLASS.match(lowered) else "other"


def _link_html(href: str | None, label: str) -> str:
    if href is not None and safe_href(href):
        return f'<a href="{escape(href)}">{escape(label)}</a>'
    return escape(label)


def concept_body(concept: PublishConcept, model: PublishModel) -> str:
    page = concept_page_path(concept.concept_id)
    resolver = make_resolver(model, concept.directory, page)
    badges = []
    if concept.type:
        badges.append(f'<span class="badge type">{escape(concept.type)}</span>')
    badges.append(f'<span class="badge status status-{_status_class(concept.status)}">{escape(concept.status)}</span>')
    badges.append(f'<span class="badge trust trust-{concept.trust_tier}">{escape(concept.trust_tier)}</span>')
    parts = [
        '<article class="concept">',
        f'<p class="concept-id"><code>{escape(concept.concept_id)}</code></p>',
        f"<h1>{escape(concept.title)}</h1>",
        '<p class="badges">' + " ".join(badges) + "</p>",
    ]
    if concept.description:
        parts.append(f'<p class="description">{escape(concept.description)}</p>')
    if concept.tags:
        parts.append('<ul class="tags">' + "".join(f"<li>{escape(tag)}</li>" for tag in concept.tags) + "</ul>")
    parts.append(f'<div class="body">{render_markdown(concept.body, resolver)}</div>')
    if concept.sources:
        items = []
        for source in concept.sources:
            label = _link_html(resolver(source.resource), source.title or source.resource)
            author = f" — {escape(source.author)}" if source.author else ""
            items.append(f"<li>{label}{author}</li>")
        parts.append('<section class="sources"><h2>Sources</h2><ul>' + "".join(items) + "</ul></section>")
    backlinks = model.backlinks(concept.concept_id)
    if backlinks:
        items = [
            f'<li><a href="{escape(relative_href(page, concept_page_path(source_id)))}">'
            f"{escape(model.concepts[source_id].title)}</a></li>"
            for source_id in backlinks
        ]
        parts.append('<section class="backlinks"><h2>Linked from</h2><ul>' + "".join(items) + "</ul></section>")
    parts.append("</article>")
    return "\n".join(parts)


def _markdown_text(text: str) -> str:
    return MARKDOWN_SPECIALS.sub(r"\\\1", text)


def _markdown_target(target: str) -> str:
    return f"<{target}>" if re.search(r"[\s()<>]", target) else target


def generated_listing(directory: str, model: PublishModel, title: str) -> str:
    lines = [f"# {_markdown_text(title)}", ""]
    for concept_id in model.public_ids():
        concept = model.concepts[concept_id]
        if concept.directory != directory:
            continue
        file_name = concept.path.rsplit("/", 1)[-1]
        suffix = f" - {_markdown_text(concept.description)}" if concept.description else ""
        lines.append(f"* [{_markdown_text(concept.title)}]({_markdown_target(file_name)}){suffix}")
    for child in sorted(model.public_dirs()):
        if child == "":
            continue
        parent, _, name = child.rpartition("/")
        if parent != directory:
            continue
        lines.append(f"* [{_markdown_text(name)}/]({_markdown_target(name + '/')})")
    return "\n".join(lines) + "\n"


def write_file(out_dir: Path, relative: str, content: str) -> None:
    target = out_dir / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open("w", encoding="utf-8", newline="\n") as handle:
        handle.write(content)


def copy_asset(out_dir: Path, name: str) -> str:
    relative = f"assets/{name}"
    write_file(out_dir, relative, (ASSETS_DIR / name).read_text(encoding="utf-8"))
    return relative


def render_site(model: PublishModel, index_texts: dict[str, str], out_dir: Path) -> list[str]:
    """Write concept pages, directory index pages and the stylesheet; return sorted written paths."""
    title = site_title(index_texts)
    written: list[str] = []
    for concept_id in model.public_ids():
        concept = model.concepts[concept_id]
        page = concept_page_path(concept_id)
        write_file(out_dir, page, page_shell(title=concept.title, site_title=title, page_path=page, body_html=concept_body(concept, model)))
        written.append(page)

    for directory in sorted(model.public_dirs()):
        page = dir_index_path(directory)
        name = directory.rsplit("/", 1)[-1]
        if directory in index_texts:
            text = "\n".join(line for line in index_texts[directory].split("\n") if line.strip() not in INDEX_MARKERS)
        else:
            text = generated_listing(directory, model, name or title)
        page_title = first_heading(text) or name or title
        body = render_markdown(text, make_resolver(model, directory, page))
        write_file(out_dir, page, page_shell(title=page_title, site_title=title, page_path=page, body_html=f'<div class="index">{body}</div>'))
        written.append(page)

    written.append(copy_asset(out_dir, "style.css"))
    return sorted(written)
