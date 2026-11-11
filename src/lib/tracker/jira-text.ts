/**
 * Jira text converters (PAN-5152, FR-7).
 *
 * Jira Cloud (REST v3) stores descriptions and comments as ADF, the Atlassian
 * Document Format JSON tree. Jira Data Center (REST v2) stores them as wiki
 * markup. Agents read and write Markdown, so these pure functions convert in
 * both directions. They cover the common subset (headings, paragraphs, lists
 * with one nesting level, code blocks, quotes, rules, tables and the inline
 * marks). An unknown ADF node renders its text children and never throws.
 */

export interface AdfMark {
  type: string;
  attrs?: Record<string, unknown>;
}

export interface AdfNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: AdfNode[];
  text?: string;
  marks?: AdfMark[];
}

export interface AdfDoc {
  type: 'doc';
  version: 1;
  content: AdfNode[];
}

// ─── ADF → Markdown ──────────────────────────────────────────────────────────

const BLOCK_TYPES = new Set([
  'paragraph', 'heading', 'bulletList', 'orderedList', 'listItem', 'codeBlock', 'blockquote', 'rule',
  'table', 'tableRow', 'tableHeader', 'tableCell', 'mediaSingle', 'mediaGroup',
]);

function isNode(value: unknown): value is AdfNode {
  return typeof value === 'object' && value !== null && typeof (value as AdfNode).type === 'string';
}

function children(node: AdfNode): AdfNode[] {
  return Array.isArray(node.content) ? node.content.filter(isNode) : [];
}

function attr(node: AdfNode, name: string): unknown {
  return node.attrs?.[name];
}

function hasBlockChild(node: AdfNode): boolean {
  return children(node).some(child => BLOCK_TYPES.has(child.type) || (child.content !== undefined && hasBlockChild(child)));
}

function renderText(node: AdfNode): string {
  let text = node.text ?? '';
  const marks = node.marks ?? [];
  const has = (type: string) => marks.some(mark => mark.type === type);
  if (has('code')) text = `\`${text}\``;
  if (has('strike')) text = `~~${text}~~`;
  if (has('em')) text = `*${text}*`;
  if (has('strong')) text = `**${text}**`;
  const link = marks.find(mark => mark.type === 'link');
  const href = typeof link?.attrs?.href === 'string' ? link.attrs.href : undefined;
  if (href) text = text === href ? href : `[${text}](${href})`;
  return text;
}

function renderInline(nodes: AdfNode[]): string {
  return nodes.map(node => {
    switch (node.type) {
      case 'text': return renderText(node);
      case 'hardBreak': return '\n';
      case 'mention': return `@${String(attr(node, 'text') ?? '').replace(/^@/, '')}`;
      case 'emoji': return String(attr(node, 'text') ?? attr(node, 'shortName') ?? '');
      case 'inlineCard': return String(attr(node, 'url') ?? '');
      case 'media':
      case 'mediaInline': return '[attachment]';
      default: return node.content ? (hasBlockChild(node) ? renderBlocks(children(node)) : renderInline(children(node))) : (node.text ?? '');
    }
  }).join('');
}

function renderListItem(item: AdfNode, marker: string): string {
  const indent = ' '.repeat(marker.length);
  const parts = children(item).map(child => (child.type === 'paragraph' ? renderInline(children(child)) : renderBlock(child)));
  return marker + parts.join('\n').split('\n').join(`\n${indent}`);
}

function renderList(node: AdfNode, ordered: boolean): string {
  const start = typeof attr(node, 'order') === 'number' ? (attr(node, 'order') as number) : 1;
  return children(node)
    .map((item, index) => renderListItem(item, ordered ? `${start + index}. ` : '- '))
    .join('\n');
}

function renderCell(cell: AdfNode): string {
  return children(cell)
    .map(child => (child.type === 'paragraph' ? renderInline(children(child)) : renderBlock(child)))
    .join(' ')
    .replace(/\n/g, ' ')
    .replace(/\|/g, '\\|');
}

function renderTable(node: AdfNode): string {
  const rows = children(node).filter(row => row.type === 'tableRow').map(row => children(row).map(renderCell));
  if (rows.length === 0) return '';
  const width = Math.max(...rows.map(row => row.length));
  const line = (cells: string[]) => `| ${Array.from({ length: width }, (_, i) => cells[i] ?? '').join(' | ')} |`;
  const [header, ...body] = rows;
  return [line(header), `| ${Array.from({ length: width }, () => '---').join(' | ')} |`, ...body.map(line)].join('\n');
}

function renderBlock(node: AdfNode): string {
  switch (node.type) {
    case 'paragraph': return renderInline(children(node));
    case 'heading': {
      const level = Math.min(Math.max(Number(attr(node, 'level')) || 1, 1), 6);
      return `${'#'.repeat(level)} ${renderInline(children(node))}`;
    }
    case 'bulletList': return renderList(node, false);
    case 'orderedList': return renderList(node, true);
    case 'listItem': return renderListItem(node, '- ');
    case 'codeBlock': {
      const language = typeof attr(node, 'language') === 'string' ? (attr(node, 'language') as string) : '';
      return `\`\`\`${language}\n${children(node).map(child => child.text ?? '').join('')}\n\`\`\``;
    }
    case 'blockquote': return renderBlocks(children(node)).split('\n').map(line => (line ? `> ${line}` : '>')).join('\n');
    case 'rule': return '---';
    case 'table': return renderTable(node);
    case 'mediaSingle':
    case 'mediaGroup':
    case 'media': return '[attachment]';
    default: return hasBlockChild(node) ? renderBlocks(children(node)) : renderInline(children(node)) || (node.text ?? '');
  }
}

/** Blocks that end themselves, so the next block needs no blank line before it. */
function separator(previous: AdfNode, next: AdfNode): string {
  const selfClosing = (type: string) => type === 'heading' || type === 'codeBlock' || type === 'rule';
  const interrupts = (type: string) => type === 'heading' || type === 'codeBlock';
  return selfClosing(previous.type) || interrupts(next.type) ? '\n' : '\n\n';
}

function renderBlocks(nodes: AdfNode[]): string {
  let out = '';
  nodes.forEach((node, index) => {
    const rendered = renderBlock(node);
    out += index === 0 ? rendered : separator(nodes[index - 1], node) + rendered;
  });
  return out;
}

/** Render an ADF document as Markdown. Non-object input gives `''`. */
export function adfToMarkdown(doc: unknown): string {
  if (!isNode(doc)) return '';
  return doc.type === 'doc' ? renderBlocks(children(doc)) : renderBlock(doc);
}

// ─── Markdown → ADF ──────────────────────────────────────────────────────────

const INLINE_PATTERN =
  /`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)|\*\*(.+?)\*\*|~~(.+?)~~|(?<![\w*])\*([^*\s][^*]*?)\*(?![\w*])|(?<![\w])_([^_\s][^_]*?)_(?![\w])|(https?:\/\/[^\s)]+)/g;

function withMark(nodes: AdfNode[], mark: AdfMark): AdfNode[] {
  return nodes.map(node => (node.type === 'text' ? { ...node, marks: [...(node.marks ?? []), mark] } : node));
}

function parseInline(text: string): AdfNode[] {
  const nodes: AdfNode[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE_PATTERN)) {
    const index = match.index ?? 0;
    if (index > last) nodes.push({ type: 'text', text: text.slice(last, index) });
    const [, code, linkText, linkHref, strong, strike, emStar, emUnderscore, url] = match;
    if (code !== undefined) nodes.push({ type: 'text', text: code, marks: [{ type: 'code' }] });
    else if (linkText !== undefined) nodes.push(...withMark(parseInline(linkText), { type: 'link', attrs: { href: linkHref } }));
    else if (strong !== undefined) nodes.push(...withMark(parseInline(strong), { type: 'strong' }));
    else if (strike !== undefined) nodes.push(...withMark(parseInline(strike), { type: 'strike' }));
    else if (emStar !== undefined || emUnderscore !== undefined) nodes.push(...withMark(parseInline(emStar ?? emUnderscore), { type: 'em' }));
    else if (url !== undefined) nodes.push({ type: 'text', text: url, marks: [{ type: 'link', attrs: { href: url } }] });
    last = index + match[0].length;
  }
  if (last < text.length) nodes.push({ type: 'text', text: text.slice(last) });
  return nodes;
}

function paragraph(lines: string[]): AdfNode {
  const content: AdfNode[] = [];
  lines.forEach((line, index) => {
    if (index > 0) content.push({ type: 'hardBreak' });
    content.push(...parseInline(line));
  });
  return { type: 'paragraph', content };
}

const FENCE = /^```\s*([\w+#.-]*)\s*$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const RULE = /^(?:-{3,}|\*{3,}|_{3,})\s*$/;
const LIST_ITEM = /^(\s*)([-*]|\d+\.)\s+(.*)$/;

function listNode(ordered: boolean, start?: number): AdfNode {
  return ordered
    ? { type: 'orderedList', ...(start !== undefined && start !== 1 ? { attrs: { order: start } } : {}), content: [] }
    : { type: 'bulletList', content: [] };
}

function parseList(lines: string[], start: number): { node: AdfNode; next: number } {
  const first = LIST_ITEM.exec(lines[start])!;
  const ordered = /\d/.test(first[2]);
  const root = listNode(ordered, ordered ? Number.parseInt(first[2], 10) : undefined);
  const baseIndent = first[1].length;
  let index = start;
  while (index < lines.length) {
    const match = LIST_ITEM.exec(lines[index]);
    if (!match) break;
    const indent = match[1].length;
    const item: AdfNode = { type: 'listItem', content: [paragraph([match[3]])] };
    const lastItem = root.content!.at(-1);
    if (indent >= baseIndent + 2 && lastItem) {
      const nestedOrdered = /\d/.test(match[2]);
      let nested = lastItem.content!.find(child => child.type === (nestedOrdered ? 'orderedList' : 'bulletList'));
      if (!nested) {
        nested = listNode(nestedOrdered, nestedOrdered ? Number.parseInt(match[2], 10) : undefined);
        lastItem.content!.push(nested);
      }
      nested.content!.push(item);
    } else if (indent < baseIndent + 2 && /\d/.test(match[2]) === ordered) {
      root.content!.push(item);
    } else {
      break;
    }
    index++;
  }
  return { node: root, next: index };
}

function parseBlocks(lines: string[]): AdfNode[] {
  const blocks: AdfNode[] = [];
  let pending: string[] = [];
  const flush = () => {
    if (pending.length > 0) blocks.push(paragraph(pending));
    pending = [];
  };
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    const fence = FENCE.exec(line);
    if (fence) {
      flush();
      const body: string[] = [];
      index++;
      while (index < lines.length && !/^```\s*$/.test(lines[index])) body.push(lines[index++]);
      index++;
      blocks.push({
        type: 'codeBlock',
        ...(fence[1] ? { attrs: { language: fence[1] } } : {}),
        ...(body.length > 0 ? { content: [{ type: 'text', text: body.join('\n') }] } : {}),
      });
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      blocks.push({ type: 'heading', attrs: { level: heading[1].length }, content: parseInline(heading[2]) });
      index++;
      continue;
    }
    if (RULE.test(line)) {
      flush();
      blocks.push({ type: 'rule' });
      index++;
      continue;
    }
    if (/^>/.test(line)) {
      flush();
      const quoted: string[] = [];
      while (index < lines.length && /^>/.test(lines[index])) quoted.push(lines[index++].replace(/^>\s?/, ''));
      blocks.push({ type: 'blockquote', content: parseBlocks(quoted) });
      continue;
    }
    if (LIST_ITEM.test(line)) {
      flush();
      const { node, next } = parseList(lines, index);
      blocks.push(node);
      index = next;
      continue;
    }
    if (line.trim() === '') {
      flush();
      index++;
      continue;
    }
    pending.push(line);
    index++;
  }
  flush();
  return blocks;
}

/** Convert Markdown to an ADF document. The result always has at least one paragraph. */
export function markdownToAdf(md: string): AdfDoc {
  const content = parseBlocks((md ?? '').replace(/\r\n?/g, '\n').split('\n'));
  return { type: 'doc', version: 1, content: content.length > 0 ? content : [{ type: 'paragraph', content: [] }] };
}

// ─── Wiki markup ⇄ Markdown ──────────────────────────────────────────────────

const WIKI_INLINE =
  /\{\{(.+?)\}\}|\[([^\]|]+)\|([^\]]+)\]|\[(https?:\/\/[^\]\s]+)\]|(?<![\w*])\*([^*\s][^*]*?)\*(?![\w*])|(?<![\w])_([^_\s][^_]*?)_(?![\w])|(?<![\w-])-([^-\s][^-]*?)-(?![\w-])/g;

function wikiInlineToMarkdown(text: string): string {
  return text.replace(WIKI_INLINE, (_whole, mono, linkText, linkHref, bareLink, bold, italic, strike) => {
    if (mono !== undefined) return `\`${mono}\``;
    if (linkText !== undefined) return `[${wikiInlineToMarkdown(linkText)}](${linkHref})`;
    if (bareLink !== undefined) return bareLink;
    if (bold !== undefined) return `**${wikiInlineToMarkdown(bold)}**`;
    if (italic !== undefined) return `*${wikiInlineToMarkdown(italic)}*`;
    return `~~${wikiInlineToMarkdown(strike)}~~`;
  });
}

function wikiTableRow(line: string, header: boolean): string[] {
  const separator = header ? '||' : '|';
  return line.trim().slice(separator.length, -separator.length).split(separator).map(cell => wikiInlineToMarkdown(cell.trim()));
}

/** Convert Jira wiki markup to Markdown. Unrecognized markup passes through. */
export function wikiToMarkdown(text: string): string {
  const lines = (text ?? '').replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  const counters: Array<{ char: string; n: number }> = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    const code = /^\{(code|noformat)(?::([^}|]*))?[^}]*\}(.*)$/.exec(line);
    if (code) {
      const [, kind, language, rest] = code;
      const close = new RegExp(`\\{${kind}\\}`);
      const body: string[] = [];
      if (close.test(rest)) {
        body.push(rest.slice(0, rest.search(close)));
        index++;
      } else {
        if (rest) body.push(rest);
        index++;
        while (index < lines.length && !close.test(lines[index])) body.push(lines[index++]);
        if (index < lines.length) {
          const tail = lines[index].slice(0, lines[index].search(close));
          if (tail) body.push(tail);
          index++;
        }
      }
      out.push(`\`\`\`${kind === 'code' ? (language ?? '').trim() : ''}`, ...body, '```');
      counters.length = 0;
      continue;
    }
    const list = /^([*#]+)\s+(.*)$/.exec(line);
    if (list) {
      const markers = list[1];
      const depth = markers.length - 1;
      const char = markers.slice(-1);
      counters.length = depth + 1;
      counters[depth] = counters[depth]?.char === char ? { char, n: counters[depth].n + 1 } : { char, n: 1 };
      const indent = markers.slice(0, -1).split('').map(m => (m === '#' ? '   ' : '  ')).join('');
      const marker = char === '#' ? `${counters[depth].n}. ` : '- ';
      out.push(`${indent}${marker}${wikiInlineToMarkdown(list[2])}`);
      index++;
      continue;
    }
    counters.length = 0;
    const heading = /^h([1-6])\.\s+(.*)$/.exec(line);
    if (heading) out.push(`${'#'.repeat(Number(heading[1]))} ${wikiInlineToMarkdown(heading[2])}`);
    else if (/^\|\|.*\|\|\s*$/.test(line)) {
      const cells = wikiTableRow(line, true);
      out.push(`| ${cells.join(' | ')} |`, `| ${cells.map(() => '---').join(' | ')} |`);
    } else if (/^\|.*\|\s*$/.test(line)) out.push(`| ${wikiTableRow(line, false).join(' | ')} |`);
    else if (/^bq\.\s+/.test(line)) out.push(`> ${wikiInlineToMarkdown(line.replace(/^bq\.\s+/, ''))}`);
    else if (/^-{4,}\s*$/.test(line)) out.push('---');
    else out.push(wikiInlineToMarkdown(line));
    index++;
  }
  return out.join('\n');
}

const MD_INLINE =
  /`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)|\*\*(.+?)\*\*|~~(.+?)~~|(?<![\w*])\*([^*\s][^*]*?)\*(?![\w*])|(?<![\w])_([^_\s][^_]*?)_(?![\w])/g;

function markdownInlineToWiki(text: string): string {
  return text.replace(MD_INLINE, (_whole, code, linkText, linkHref, strong, strike, emStar, emUnderscore) => {
    if (code !== undefined) return `{{${code}}}`;
    if (linkText !== undefined) return `[${markdownInlineToWiki(linkText)}|${linkHref}]`;
    if (strong !== undefined) return `*${markdownInlineToWiki(strong)}*`;
    if (strike !== undefined) return `-${markdownInlineToWiki(strike)}-`;
    return `_${markdownInlineToWiki(emStar ?? emUnderscore)}_`;
  });
}

function markdownTableCells(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map(cell => markdownInlineToWiki(cell.trim().replace(/\\\|/g, '|')));
}

/** Convert Markdown to Jira wiki markup, for the same subset as {@link wikiToMarkdown}. */
export function markdownToWiki(md: string): string {
  const lines = (md ?? '').replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  const listStack: Array<{ indent: number; char: '*' | '#' }> = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    const fence = FENCE.exec(line);
    if (fence) {
      out.push(fence[1] ? `{code:${fence[1]}}` : '{code}');
      index++;
      while (index < lines.length && !/^```\s*$/.test(lines[index])) out.push(lines[index++]);
      out.push('{code}');
      index++;
      listStack.length = 0;
      continue;
    }
    const item = LIST_ITEM.exec(line);
    if (item) {
      const indent = item[1].length;
      while (listStack.length > 0 && indent < listStack[listStack.length - 1].indent) listStack.pop();
      const char = /\d/.test(item[2]) ? '#' : '*';
      const top = listStack[listStack.length - 1];
      if (!top || indent > top.indent) listStack.push({ indent, char });
      else listStack[listStack.length - 1] = { indent, char };
      out.push(`${listStack.map(level => level.char).join('')} ${markdownInlineToWiki(item[3])}`);
      index++;
      continue;
    }
    listStack.length = 0;
    const heading = HEADING.exec(line);
    const next = lines[index + 1];
    if (heading) out.push(`h${heading[1].length}. ${markdownInlineToWiki(heading[2])}`);
    else if (/^\|.*\|\s*$/.test(line) && next !== undefined && /^\|\s*:?-{3,}/.test(next)) {
      out.push(`||${markdownTableCells(line).join('||')}||`);
      index++;
    } else if (/^\|.*\|\s*$/.test(line)) out.push(`|${markdownTableCells(line).join('|')}|`);
    else if (RULE.test(line)) out.push('----');
    else if (/^>/.test(line)) out.push(`bq. ${markdownInlineToWiki(line.replace(/^>\s?/, ''))}`);
    else out.push(markdownInlineToWiki(line));
    index++;
  }
  return out.join('\n');
}
