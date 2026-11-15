#!/usr/bin/env python3
"""Render a Markdown subset to fully escaped HTML for published OKF pages."""

from __future__ import annotations

from dataclasses import dataclass, field
import html
import re
from typing import Callable, Optional

LinkResolver = Callable[[str], Optional[str]]

SAFE_SCHEMES = ("http:", "https:", "mailto:")

FENCE_OPEN = re.compile(r"^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)")
INFO_WORD = re.compile(r"^[A-Za-z0-9_+-]+$")
HEADING = re.compile(r"^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$")
HEADING_CLOSE = re.compile(r"(?:^|[ \t]+)#+$")
THEMATIC_BREAK = re.compile(r"^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$")
BLOCKQUOTE = re.compile(r"^ {0,3}> ?")
LIST_ITEM = re.compile(r"^( *)([-*+]|\d{1,9}[.)])(?:[ \t]+(.*))?$")
TABLE_SEPARATOR = re.compile(r"^ *\|? *:?-+:? *(?:\| *:?-+:? *)*\|? *$")
FOOTNOTE_DEF = re.compile(r"^\[\^([^\]\s]+)\]:[ \t]?(.*)$")
AUTOLINK = re.compile(r"<((?:https?://|mailto:)[^\s<>]+)>", re.IGNORECASE)
PLACEHOLDER = re.compile("\x00(\\d+)\x00")
ASCII_PUNCTUATION = set("!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~")

STRONG_STAR = re.compile(r"\*\*(?=\S)(.+?)(?<=\S)\*\*")
STRONG_UNDERSCORE = re.compile(r"(?<![A-Za-z0-9_])__(?=\S)(.+?)(?<=\S)__(?![A-Za-z0-9_])")
EM_STAR = re.compile(r"(?<!\*)\*(?=[^\s*])(.+?)(?<=[^\s*])\*(?!\*)")
EM_UNDERSCORE = re.compile(r"(?<![A-Za-z0-9_])_(?=[^\s_])(.+?)(?<=[^\s_])_(?![A-Za-z0-9_])")


def escape(text: str) -> str:
    return html.escape(text, quote=True)


def slugify(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def safe_href(href: str) -> bool:
    """Return True when an href may be emitted: relative, or http/https/mailto."""
    if not href or any(ord(char) <= 0x20 or ord(char) == 0x7F for char in href):
        return False
    head = re.split(r"[/?#]", href, maxsplit=1)[0]
    if ":" not in head:
        return True
    return href.lower().startswith(SAFE_SCHEMES)


@dataclass
class _Context:
    resolve_link: LinkResolver
    footnote_defs: dict[str, str] = field(default_factory=dict)
    footnote_order: list[str] = field(default_factory=list)
    slug_counts: dict[str, int] = field(default_factory=dict)

    def heading_id(self, text: str) -> str:
        base = slugify(text) or "section"
        count = self.slug_counts.get(base, 0) + 1
        self.slug_counts[base] = count
        return base if count == 1 else f"{base}-{count}"


def render_markdown(text: str, resolve_link: LinkResolver) -> str:
    """Render ``text`` to HTML; ``resolve_link`` maps a raw link target to an href or None."""
    context = _Context(resolve_link=resolve_link)
    lines = _collect_footnotes(text.replace("\x00", "").replace("\r\n", "\n").replace("\r", "\n").split("\n"), context)
    parts = _render_blocks(lines, context)
    footnotes = _render_footnotes(context)
    if footnotes:
        parts.append(footnotes)
    return "\n".join(parts)


def _collect_footnotes(lines: list[str], context: _Context) -> list[str]:
    output: list[str] = []
    fence: Optional[str] = None
    for line in lines:
        if fence is not None:
            if _closes_fence(line, fence):
                fence = None
            output.append(line)
            continue
        opening = FENCE_OPEN.match(line)
        if opening:
            fence = opening.group(1)
            output.append(line)
            continue
        definition = FOOTNOTE_DEF.match(line)
        if definition:
            context.footnote_defs.setdefault(definition.group(1), definition.group(2))
            continue
        output.append(line)
    return output


def _closes_fence(line: str, fence: str) -> bool:
    stripped = line.strip()
    return len(stripped) >= len(fence) and set(stripped) == {fence[0]} and len(line) - len(line.lstrip(" ")) <= 3


def _is_table_start(lines: list[str], index: int) -> bool:
    return (
        index + 1 < len(lines)
        and "|" in lines[index]
        and "|" in lines[index + 1]
        and TABLE_SEPARATOR.match(lines[index + 1]) is not None
    )


def _starts_block(lines: list[str], index: int) -> bool:
    line = lines[index]
    return bool(
        FENCE_OPEN.match(line)
        or HEADING.match(line)
        or THEMATIC_BREAK.match(line)
        or BLOCKQUOTE.match(line)
        or (LIST_ITEM.match(line) and LIST_ITEM.match(line).group(3))
        or _is_table_start(lines, index)
    )


def _render_blocks(lines: list[str], context: _Context) -> list[str]:
    parts: list[str] = []
    index = 0
    while index < len(lines):
        line = lines[index]
        if not line.strip():
            index += 1
            continue

        opening = FENCE_OPEN.match(line)
        if opening:
            fence = opening.group(1)
            word = opening.group(2)
            index += 1
            content: list[str] = []
            while index < len(lines) and not _closes_fence(lines[index], fence):
                content.append(lines[index])
                index += 1
            index += 1
            attr = f' class="language-{escape(word)}"' if word and INFO_WORD.match(word) else ""
            code = escape("\n".join(content) + ("\n" if content else ""))
            parts.append(f"<pre><code{attr}>{code}</code></pre>")
            continue

        heading = HEADING.match(line)
        if heading:
            level = len(heading.group(1))
            raw = HEADING_CLOSE.sub("", heading.group(2) or "").strip()
            parts.append(f'<h{level} id="{escape(context.heading_id(raw))}">{_render_inline(raw, context)}</h{level}>')
            index += 1
            continue

        if THEMATIC_BREAK.match(line):
            parts.append("<hr>")
            index += 1
            continue

        if BLOCKQUOTE.match(line):
            quoted: list[str] = []
            while index < len(lines) and BLOCKQUOTE.match(lines[index]):
                quoted.append(BLOCKQUOTE.sub("", lines[index], count=1))
                index += 1
            inner = "\n".join(_render_blocks(quoted, context))
            parts.append(f"<blockquote>\n{inner}\n</blockquote>")
            continue

        if _is_table_start(lines, index):
            table_html, index = _render_table(lines, index, context)
            parts.append(table_html)
            continue

        item = LIST_ITEM.match(line)
        if item and item.group(3):
            list_html, index = _render_list(lines, index, len(item.group(1)), context)
            parts.append(list_html)
            continue

        paragraph = [line.strip()]
        index += 1
        while index < len(lines) and lines[index].strip() and not _starts_block(lines, index):
            paragraph.append(lines[index].strip())
            index += 1
        parts.append(f"<p>{_render_inline(chr(10).join(paragraph), context)}</p>")
    return parts


def _split_cells(row: str) -> list[str]:
    stripped = row.strip()
    if stripped.startswith("|"):
        stripped = stripped[1:]
    if stripped.endswith("|") and not stripped.endswith("\\|"):
        stripped = stripped[:-1]
    cells = re.split(r"(?<!\\)\|", stripped)
    return [cell.strip().replace("\\|", "|") for cell in cells]


def _render_table(lines: list[str], index: int, context: _Context) -> tuple[str, int]:
    header = _split_cells(lines[index])
    index += 2
    rows: list[list[str]] = []
    while index < len(lines) and lines[index].strip() and "|" in lines[index]:
        rows.append(_split_cells(lines[index]))
        index += 1
    head = "".join(f"<th>{_render_inline(cell, context)}</th>" for cell in header)
    out = ["<table>", f"<thead><tr>{head}</tr></thead>", "<tbody>"]
    for row in rows:
        cells = (row + [""] * len(header))[: len(header)]
        out.append("<tr>" + "".join(f"<td>{_render_inline(cell, context)}</td>" for cell in cells) + "</tr>")
    out.append("</tbody>")
    out.append("</table>")
    return "\n".join(out), index


def _list_kind(marker: str) -> str:
    return "ul" if marker in ("-", "*", "+") else "ol"


def _render_list(lines: list[str], index: int, base_indent: int, context: _Context) -> tuple[str, int]:
    first = LIST_ITEM.match(lines[index])
    assert first is not None
    kind = _list_kind(first.group(2))
    start = ""
    if kind == "ol":
        number = int(first.group(2)[:-1])
        if number != 1:
            start = f' start="{number}"'
    items: list[str] = []
    while index < len(lines):
        match = LIST_ITEM.match(lines[index])
        if not match or not match.group(3) or len(match.group(1)) != base_indent or _list_kind(match.group(2)) != kind:
            break
        text_lines = [match.group(3).strip()]
        nested: list[str] = []
        index += 1
        while index < len(lines):
            line = lines[index]
            if not line.strip():
                lookahead = index + 1
                while lookahead < len(lines) and not lines[lookahead].strip():
                    lookahead += 1
                following = LIST_ITEM.match(lines[lookahead]) if lookahead < len(lines) else None
                if following and following.group(3) and len(following.group(1)) >= base_indent:
                    index = lookahead
                    continue
                break
            child = LIST_ITEM.match(line)
            if child and child.group(3):
                indent = len(child.group(1))
                if indent >= base_indent + 2:
                    nested_html, index = _render_list(lines, index, indent, context)
                    nested.append(nested_html)
                    continue
                break
            if not nested and not _starts_block(lines, index):
                text_lines.append(line.strip())
                index += 1
                continue
            break
        body = _render_inline("\n".join(text_lines), context)
        items.append("<li>" + body + ("\n" + "\n".join(nested) if nested else "") + "</li>")
    return f"<{kind}{start}>\n" + "\n".join(items) + f"\n</{kind}>", index


def _render_footnotes(context: _Context) -> str:
    labels = list(context.footnote_order)
    rendered: list[str] = []
    position = 0
    while position < len(labels):
        label = labels[position]
        slug = escape(_footnote_slug(label))
        body = _render_inline(context.footnote_defs[label], context)
        labels = list(context.footnote_order)
        rendered.append(f'<li id="fn-{slug}">{body} <a class="fnback" href="#fnref-{slug}">&#8617;</a></li>')
        position += 1
    if not rendered:
        return ""
    return '<section class="footnotes">\n<ol>\n' + "\n".join(rendered) + "\n</ol>\n</section>"


def _footnote_slug(label: str) -> str:
    return slugify(label) or "note"


def _find_closing_bracket(text: str, start: int) -> int:
    depth = 0
    index = start
    while index < len(text):
        char = text[index]
        if char == "\\":
            index += 2
            continue
        if char == "[":
            depth += 1
        elif char == "]":
            depth -= 1
            if depth == 0:
                return index
        index += 1
    return -1


def _parse_destination(text: str, start: int) -> Optional[tuple[str, int]]:
    """Parse ``(target "title")`` starting at the ``(``; return (target, index after ``)``)."""
    index = start + 1
    while index < len(text) and text[index] in " \t":
        index += 1
    if index < len(text) and text[index] == "<":
        end = text.find(">", index)
        if end == -1 or "\n" in text[index:end]:
            return None
        target = text[index + 1 : end]
        index = end + 1
    else:
        depth = 0
        begin = index
        while index < len(text):
            char = text[index]
            if char.isspace():
                break
            if char == "(":
                depth += 1
            elif char == ")":
                if depth == 0:
                    break
                depth -= 1
            index += 1
        target = text[begin:index]
    while index < len(text) and text[index] in " \t\n":
        index += 1
    if index < len(text) and text[index] in "\"'":
        quote = text[index]
        end = text.find(quote, index + 1)
        if end == -1:
            return None
        index = end + 1
        while index < len(text) and text[index] in " \t":
            index += 1
    if index >= len(text) or text[index] != ")":
        return None
    return target, index + 1


def _render_inline(text: str, context: _Context) -> str:
    stash: list[str] = []

    def hold(fragment: str) -> str:
        stash.append(fragment)
        return f"\x00{len(stash) - 1}\x00"

    out: list[str] = []
    index = 0
    while index < len(text):
        char = text[index]

        if char == "\\" and index + 1 < len(text) and text[index + 1] in ASCII_PUNCTUATION:
            out.append(hold(escape(text[index + 1])))
            index += 2
            continue

        if char == "`":
            run = len(text[index:]) - len(text[index:].lstrip("`"))
            run_end = index + run
            marker = "`" * run
            closing = re.compile(f"(?<!`){marker}(?!`)").search(text, run_end)
            close = closing.start() if closing else -1
            if close == -1:
                out.append(hold(escape(marker)))
                index = run_end
                continue
            code = text[run_end:close].replace("\n", " ")
            if len(code) >= 2 and code.startswith(" ") and code.endswith(" ") and code.strip():
                code = code[1:-1]
            out.append(hold(f"<code>{escape(code)}</code>"))
            index = close + run
            continue

        if char == "<":
            autolink = AUTOLINK.match(text, index)
            if autolink:
                target = autolink.group(1)
                if safe_href(target):
                    out.append(hold(f'<a href="{escape(target)}">{escape(target)}</a>'))
                else:
                    out.append(hold(escape(target)))
                index = autolink.end()
                continue

        if char == "!" and text.startswith("![", index):
            close = _find_closing_bracket(text, index + 1)
            if close != -1 and close + 1 < len(text) and text[close + 1] == "(":
                parsed = _parse_destination(text, close + 1)
                if parsed is not None:
                    out.append(hold(escape(_unescape_backslashes(text[index + 2 : close]))))
                    index = parsed[1]
                    continue

        if char == "[":
            if text.startswith("[^", index):
                end = text.find("]", index)
                label = text[index + 2 : end] if end != -1 else ""
                if end != -1 and label and label in context.footnote_defs:
                    if label not in context.footnote_order:
                        context.footnote_order.append(label)
                        anchor_id = f' id="fnref-{escape(_footnote_slug(label))}"'
                    else:
                        anchor_id = ""
                    number = context.footnote_order.index(label) + 1
                    slug = escape(_footnote_slug(label))
                    out.append(hold(f'<sup class="fnref"><a href="#fn-{slug}"{anchor_id}>{number}</a></sup>'))
                    index = end + 1
                    continue
            close = _find_closing_bracket(text, index)
            if close != -1 and close + 1 < len(text) and text[close + 1] == "(":
                parsed = _parse_destination(text, close + 1)
                if parsed is not None:
                    target, after = parsed
                    label_html = _render_inline(text[index + 1 : close], context)
                    href = context.resolve_link(target)
                    if href is not None and safe_href(href):
                        out.append(hold(f'<a href="{escape(href)}">{label_html}</a>'))
                    else:
                        out.append(hold(label_html))
                    index = after
                    continue

        out.append(char)
        index += 1

    rendered = escape("".join(out))
    rendered = STRONG_STAR.sub(r"<strong>\1</strong>", rendered)
    rendered = STRONG_UNDERSCORE.sub(r"<strong>\1</strong>", rendered)
    rendered = EM_STAR.sub(r"<em>\1</em>", rendered)
    rendered = EM_UNDERSCORE.sub(r"<em>\1</em>", rendered)
    return PLACEHOLDER.sub(lambda match: stash[int(match.group(1))], rendered)


def _unescape_backslashes(text: str) -> str:
    return re.sub(r"\\([!-/:-@\[-`{-~])", r"\1", text)


@dataclass(frozen=True)
class LinkSpan:
    start: int  # index of "[" (or "!" for an image)
    end: int  # index after the closing ")"
    is_image: bool
    label: str  # raw text between the brackets
    target: str  # raw destination, as the renderer's resolver receives it


def find_links(text: str) -> list[LinkSpan]:
    """Return inline links and images exactly as ``render_markdown`` parses them, in order."""
    spans: list[LinkSpan] = []
    index = 0
    while index < len(text):
        char = text[index]
        if char == "\\":
            index += 2
            continue
        if char != "[":
            index += 1
            continue
        is_image = index > 0 and text[index - 1] == "!" and (index < 2 or text[index - 2] != "\\")
        close = _find_closing_bracket(text, index)
        if close != -1 and close + 1 < len(text) and text[close + 1] == "(":
            parsed = _parse_destination(text, close + 1)
            if parsed is not None:
                target, after = parsed
                start = index - 1 if is_image else index
                spans.append(LinkSpan(start, after, is_image, text[index + 1 : close], target))
                index = after
                continue
        index += 1
    return spans


def strip_links(text: str) -> str:
    """Replace each link and image with its label text, dropping every destination."""
    out: list[str] = []
    position = 0
    for span in find_links(text):
        out.append(text[position : span.start])
        out.append(span.label if span.is_image else strip_links(span.label))
        position = span.end
    out.append(text[position:])
    return "".join(out)


def visible_text(line: str) -> str:
    """Approximate what a reader sees for one line: links as text, escapes and emphasis markers removed."""
    text = strip_links(line)
    text = re.sub(r"\\([!-/:-@\[-`{-~])", r"\1", text)
    text = text.replace("`", "").replace("*", "")
    return re.sub(r"(?<![A-Za-z0-9])_+|_+(?![A-Za-z0-9])", "", text)
