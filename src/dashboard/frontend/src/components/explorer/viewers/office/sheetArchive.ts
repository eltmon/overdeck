// Ported from t3code (MIT, Copyright (c) 2026 T3 Tools Inc.)
// upstream: apps/web/src/components/files/officeArchive.ts @ 2d8a843e6b
import type JSZip from 'jszip';

import { OFFICE_PREVIEW_MAX_COLUMNS, OFFICE_PREVIEW_MAX_ROWS } from './officePreviewProtocol';
import { xmlParser } from './officeXml';

function boundedWorksheet(
  xml: string,
  strings: readonly string[],
  budget: { remaining: number; cells: number },
) {
  const parser = xmlParser();
  const rows = new Map<number, Map<number, string>>();
  const rowTags = new Map<number, string>();
  const metadataAttributes = new Map<
    string,
    {
      ref: string | undefined;
      min: string | undefined;
      max: string | undefined;
      hidden: string | undefined;
    }
  >();
  let dataStart = 0;
  let dataTag = 0;
  let dataPrefix = '';
  let dataNamespace = '';
  let dataEnd = 0;
  let defaultWidth: number | undefined;
  let gridlines: boolean | undefined;
  const sizedColumns: { min: number; max: number }[] = [];
  let emptyData = false;
  let depth = 0;
  let row = 0;
  let explicitRow = false;
  let rowTag = '';
  let column = 0;
  let maxRow = 0;
  let maxColumn = 0;
  let cells = new Map<number, string>();
  let cell: {
    start: number;
    opening: string;
    name: string;
    prefix: string;
    selfClosing: boolean;
    text: string;
    value: string;
    reading: string;
    shared: boolean;
  } | null = null;
  let truncated = false;
  const coordinate = (ref: string) => {
    const match = /^([A-Z]{1,3})([1-9]\d{0,6})$/.exec(ref);
    if (!match) throw new Error('This workbook contains invalid cell coordinates.');
    let col = 0;
    for (const letter of match[1]!) col = col * 26 + letter.charCodeAt(0) - 64;
    const line = Number(match[2]);
    if (col > 16384 || line > 1048576)
      throw new Error('This workbook contains invalid worksheet dimensions.');
    return { col, line };
  };
  parser.on('opentag', (tag) => {
    depth++;
    if (depth > 64) throw new Error('This workbook contains excessive XML nesting.');
    if (
      (tag.local === 'row' && depth !== 3) ||
      (tag.local === 'c' && depth !== 4) ||
      ((tag.local === 'dimension' || tag.local === 'sheetData') && depth !== 2)
    )
      throw new Error('This workbook contains invalid worksheet structure.');
    const attribute = (name: string) => tag.attributes[name]?.value;
    if (['dimension', 'mergeCell', 'col'].includes(tag.local))
      metadataAttributes.set(
        xml.slice(xml.lastIndexOf('<', parser.position - 1), parser.position),
        {
          ref: attribute('ref'),
          min: attribute('min'),
          max: attribute('max'),
          hidden: attribute('hidden'),
        },
      );
    // The engine draws gridlines on every sheet, so the first view's choice travels beside the bytes.
    if (depth === 3 && tag.local === 'sheetView' && gridlines === undefined) {
      const shown = attribute('showGridLines');
      gridlines = shown !== '0' && shown !== 'false';
    }
    if (depth === 2 && tag.local === 'sheetFormatPr') {
      const width = Number(attribute('defaultColWidth') ?? Number.NaN);
      if (width >= 0 && width <= 255) defaultWidth = width;
    }
    if (depth === 3 && tag.local === 'col') {
      const hidden = attribute('hidden');
      const min = Number(attribute('min') ?? 1);
      const max = Number(attribute('max') ?? min);
      if (
        (attribute('width') !== undefined || hidden === '1' || hidden === 'true') &&
        Number.isInteger(min) &&
        Number.isInteger(max)
      )
        sizedColumns.push({ min, max });
    }
    if (depth === 2 && tag.local === 'sheetData') {
      dataStart = parser.position;
      dataTag = xml.lastIndexOf('<', parser.position - 1);
      dataPrefix = tag.prefix ? `${tag.prefix}:` : '';
      dataNamespace = tag.uri
        .replaceAll('&', '&amp;')
        .replaceAll('"', '&quot;')
        .replaceAll('<', '&lt;');
      emptyData = tag.isSelfClosing;
    }
    // A dimension past the limits loses nothing by itself; the cells past them say whether content is lost.
    if (depth === 2 && tag.local === 'dimension') {
      for (const ref of (attribute('ref') ?? '').split(':')) coordinate(ref);
    } else if (depth === 3 && tag.local === 'row') {
      explicitRow = attribute('r') !== undefined;
      row = attribute('r') === undefined ? row + 1 : Number(attribute('r'));
      if (!Number.isInteger(row) || row < 1 || row > 1048576)
        throw new Error('This workbook contains invalid row coordinates.');
      rowTag = xml
        .slice(xml.lastIndexOf('<', parser.position - 1), parser.position)
        .replace(/\/>$/, '>');
      column = 0;
      cells = rows.get(row) ?? new Map<number, string>();
      if (row > OFFICE_PREVIEW_MAX_ROWS)
        throw new Error('This workbook exceeds the preview limit: 250,000 rows.');
    } else if (depth === 4 && tag.local === 'c') {
      const ref = attribute('r');
      const position = ref ? coordinate(ref) : { col: column + 1, line: row };
      if (!explicitRow && column === 0) row = position.line;
      column = position.col;
      if (row < 1 || position.line !== row)
        throw new Error('This workbook contains inconsistent cell rows.');
      if (row > OFFICE_PREVIEW_MAX_ROWS || column > OFFICE_PREVIEW_MAX_COLUMNS) {
        truncated = true;
        return;
      }
      maxRow = Math.max(maxRow, row);
      maxColumn = Math.max(maxColumn, column);
      if (++budget.cells > 2_000_000 || maxRow * maxColumn > 8_000_000)
        throw new Error(
          'This workbook exceeds the preview limit: 2 million cells or 8 million grid positions.',
        );
      // Explicit coordinates also bound sheets whose rows/cells omit r.
      let letters = '';
      for (let value = column; value > 0; value = Math.floor((value - 1) / 26))
        letters = String.fromCharCode(65 + ((value - 1) % 26)) + letters;
      const style = attribute('s');
      const type = attribute('t');
      if ((style && !/^\d{1,6}$/.test(style)) || (type && !/^[a-zA-Z]+$/.test(type)))
        throw new Error('This workbook contains invalid cell metadata.');
      cell = {
        start: parser.position,
        opening: xml
          .slice(xml.lastIndexOf('<', parser.position - 1), parser.position)
          .replace(/\/?>$/, `${ref ? '' : ` r="${letters}${row}"`}>`),
        name: tag.name,
        prefix: tag.prefix ? `${tag.prefix}:` : '',
        selfClosing: tag.isSelfClosing,
        text: '',
        value: '',
        reading: '',
        shared: type === 's',
      };
    }
    if (cell && (tag.local === 't' || tag.local === 'v')) cell.reading = tag.local;
  });
  const readCellText = (chunk: string) => {
    if (cell?.reading === 't') cell.text += chunk;
    if (cell?.reading === 'v') cell.value += chunk;
  };
  parser.on('text', readCellText);
  parser.on('cdata', readCellText);
  parser.on('closetag', (tag) => {
    if (depth === 4 && tag.local === 'c' && cell) {
      const end = cell.selfClosing ? cell.start : xml.lastIndexOf('<', parser.position - 1);
      const raw = cell.opening + xml.slice(cell.start, end) + `</${cell.name}>`;
      const shown = cell.shared ? (strings[Number(cell.value)] ?? '') : cell.text || cell.value;
      const kept = shown.slice(0, Math.min(4096, budget.remaining));
      budget.remaining -= kept.length;
      if (kept.length < shown.length) {
        truncated = true;
        const escape = (s: string) =>
          s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
        cells.set(
          column,
          cell.opening
            .replace(/\s+t\s*=\s*(?:"[^"]*"|'[^']*')/, '')
            .replace(/>$/, ' t="inlineStr">') +
            `<${cell.prefix}is><${cell.prefix}t>` +
            escape(kept) +
            `</${cell.prefix}t></${cell.prefix}is></${cell.name}>`,
        );
      } else cells.set(column, raw);
      cell = null;
    } else if (depth === 3 && tag.local === 'row' && row <= OFFICE_PREVIEW_MAX_ROWS) {
      rows.set(row, cells);
      rowTags.set(row, rowTag);
    }
    if (depth === 2 && tag.local === 'sheetData')
      dataEnd = emptyData ? parser.position : xml.lastIndexOf('<', parser.position - 1);
    if (cell?.reading === tag.local) cell.reading = '';
    depth--;
  });
  parser.write(xml).close();
  if (!dataStart) throw new Error('This workbook has no worksheet data.');
  const boundRange = (ref: string) => {
    const [a, b = a] = ref.split(':');
    const first = coordinate(a!);
    const last = coordinate(b!);
    if (first.col > OFFICE_PREVIEW_MAX_COLUMNS || first.line > OFFICE_PREVIEW_MAX_ROWS) return '';
    let letters = '';
    for (
      let col = Math.min(OFFICE_PREVIEW_MAX_COLUMNS, last.col);
      col > 0;
      col = Math.floor((col - 1) / 26)
    )
      letters = String.fromCharCode(65 + ((col - 1) % 26)) + letters;
    return a + ':' + letters + Math.min(OFFICE_PREVIEW_MAX_ROWS, last.line);
  };
  const metadata = (part: string) =>
    part.replace(
      /(<((?:\w+:)?(?:dimension|mergeCell|col))\b(?:[^"'<>]|"[^"]*"|'[^']*')*>)(?:\s*<\/\2\s*>)?/g,
      (tag: string, opening: string) => {
        const attributes = metadataAttributes.get(opening);
        if (!attributes) return tag;
        const replace = (name: string, value: string) => {
          const pattern = new RegExp(`\\s${name}\\s*=\\s*(?:"[^"]*"|'[^']*')`);
          tag = pattern.test(tag)
            ? tag.replace(pattern, ` ${name}="${value}"`)
            : tag.replace(/\/?>/, (end) => ` ${name}="${value}"${end}`);
        };
        if (attributes.ref !== undefined) {
          const bounded = boundRange(attributes.ref);
          if (!bounded) return '';
          replace('ref', bounded);
        }
        if (/<(?:\w+:)?col\b/.test(opening)) {
          const min = Math.max(1, Number(attributes.min ?? 1));
          // Hidden columns keep their full span, or the columns past the limit would show again.
          const hidden = attributes.hidden === '1' || attributes.hidden === 'true';
          const max = Math.min(
            hidden ? 16384 : OFFICE_PREVIEW_MAX_COLUMNS,
            Number(attributes.max ?? 16384),
          );
          if (!Number.isInteger(min) || !Number.isInteger(max) || min > max) return '';
          replace('min', String(min));
          replace('max', String(max));
        }
        return tag;
      },
    );
  // The engine sizes columns without a width at Excel's 8.43 characters and ignores `defaultColWidth`, so the
  // columns it covers get that width spelled out. A second `<cols>` is valid: the schema allows any number.
  let defaultColumns = '';
  if (defaultWidth !== undefined) {
    let next = 1;
    for (const span of [...sizedColumns].sort((a, b) => a.min - b.min)) {
      if (span.min > next)
        defaultColumns += `<${dataPrefix}col min="${next}" max="${Math.min(span.min - 1, OFFICE_PREVIEW_MAX_COLUMNS)}" width="${defaultWidth}"/>`;
      next = Math.max(next, span.max + 1);
      if (next > OFFICE_PREVIEW_MAX_COLUMNS) break;
    }
    if (next <= OFFICE_PREVIEW_MAX_COLUMNS)
      defaultColumns += `<${dataPrefix}col min="${next}" max="${OFFICE_PREVIEW_MAX_COLUMNS}" width="${defaultWidth}"/>`;
    if (defaultColumns)
      defaultColumns = `<${dataPrefix}cols xmlns${dataPrefix ? `:${dataPrefix.slice(0, -1)}` : ''}="${dataNamespace}">${defaultColumns}</${dataPrefix}cols>`;
  }
  const head = (part: string) =>
    metadata(part.slice(0, dataTag) + defaultColumns + part.slice(dataTag));
  return {
    xml: emptyData
      ? head(xml)
      : `${head(xml.slice(0, dataStart))}${[...rows]
          .sort(([a], [b]) => a - b)
          .map(
            ([line, values]) =>
              `${rowTags.get(line) ?? `<row r="${line}">`}${[...values]
                .sort(([a], [b]) => a - b)
                .map(([, value]) => value)
                .join('')}</${/^<([^\s>]+)/.exec(rowTags.get(line) ?? '<row>')![1]}>`,
          )
          .join('')}${metadata(xml.slice(dataEnd))}`,
    truncated,
    gridlines: gridlines ?? true,
  };
}

/**
 * A stylesheet as Excel reads it, in the terms the engine understands. The engine takes a number format id under 164 as
 * Excel's built-in one, though workbooks define their own there (Excel writes its locale formats 5 to 8 that way), so
 * those move to free ids. It also reads `<u val="…">` as a boolean, which loses every named underline but the bare one.
 */
function engineStyles(xml: string) {
  const name = (local: string) => `<((?:[\\w.-]+:)?)${local}\\b`;
  const blocks = new Map<string, { start: number; end: number }>();
  const parser = xmlParser();
  let depth = 0;
  parser.on('opentag', (tag) => {
    if (++depth > 64) throw new Error('This workbook contains excessive XML nesting.');
    if (depth !== 2 || !['numFmts', 'cellStyleXfs', 'cellXfs'].includes(tag.local)) return;
    if (blocks.has(tag.local))
      throw new Error('This workbook contains duplicate stylesheet blocks.');
    blocks.set(tag.local, {
      start: xml.lastIndexOf('<', parser.position - 1),
      end: parser.position,
    });
  });
  parser.on('closetag', (tag) => {
    if (depth === 2) {
      const block = blocks.get(tag.local);
      if (block) block.end = parser.position;
    }
    depth--;
  });
  parser.write(xml).close();
  const id = /(numFmtId\s*=\s*)(["'])(\d+)\2/g;
  const moved = new Map<number, number>();
  const formatBlock = blocks.get('numFmts');
  const formats = formatBlock ? xml.slice(formatBlock.start, formatBlock.end) : '';
  const used = new Set([...formats.matchAll(id)].map((match) => Number(match[3])));
  let next = 164;
  const renumber = (part: string, assign: boolean) =>
    part.replace(id, (attribute: string, key: string, quote: string, value: string) => {
      const number = Number(value);
      if (assign && number < 164 && !moved.has(number)) {
        while (used.has(next)) next++;
        if (next > 65535) throw new Error('This workbook has too many custom number formats.');
        moved.set(number, next++);
      }
      const to = moved.get(number);
      return to === undefined ? attribute : `${key}${quote}${to}${quote}`;
    });
  const numberedFormats = renumber(formats, true);
  const parts: string[] = [];
  let offset = 0;
  for (const [local, block] of blocks) {
    parts.push(
      xml.slice(offset, block.start),
      local === 'numFmts' ? numberedFormats : renumber(xml.slice(block.start, block.end), false),
    );
    offset = block.end;
  }
  parts.push(xml.slice(offset));
  return parts
    .join('')
    .replace(
      new RegExp(
        `${name('u')}\\s+val\\s*=\\s*(["'])(?:single|double|singleAccounting|doubleAccounting)\\2\\s*(?:/>|>\\s*</\\1u\\s*>)`,
        'g',
      ),
      '<$1u/>',
    );
}

export async function boundWorkbook(archive: JSZip) {
  const paths = new Map<string, string>();
  // Chart sheets and other non-grid sheets hold no cells to bound.
  const otherSheets = new Set<string>();
  let sharedPath = 'xl/sharedStrings.xml';
  let stylesPath = 'xl/styles.xml';
  let themePath = 'xl/theme/theme1.xml';
  const relationships = xmlParser();
  relationships.on('opentag', (tag) => {
    if (tag.local !== 'Relationship') return;
    const type = tag.attributes.Type?.value;
    const path = new URL(
      tag.attributes.Target?.value ?? '',
      'https://docx.invalid/xl/workbook.xml',
    ).pathname.slice(1);
    if (type?.endsWith('/worksheet')) paths.set(tag.attributes.Id?.value ?? '', path);
    else if (/\/(?:chartsheet|dialogsheet|xlMacrosheet|xlIntlMacrosheet)$/.test(type ?? ''))
      otherSheets.add(tag.attributes.Id?.value ?? '');
    if (type?.endsWith('/sharedStrings')) sharedPath = path;
    if (type?.endsWith('/styles')) stylesPath = path;
    if (type?.endsWith('/theme')) themePath = path;
  });
  relationships
    .write((await archive.file('xl/_rels/workbook.xml.rels')?.async('string')) ?? '')
    .close();
  const sheetPaths: string[] = [];
  // Every sheet in workbook order, as the engine indexes them; chart sheets have no worksheet path.
  const sheetOrder: (string | undefined)[] = [];
  const workbook = xmlParser();
  workbook.on('opentag', (tag) => {
    if (tag.local !== 'sheet') return;
    const id = Object.values(tag.attributes).find((attribute) => attribute.local === 'id')?.value;
    if (otherSheets.has(id ?? '')) {
      sheetOrder.push(undefined);
      return;
    }
    const path = paths.get(id ?? '');
    if (!path || sheetPaths.length === 100)
      throw new Error('This workbook has invalid or too many sheets.');
    sheetPaths.push(path);
    sheetOrder.push(path);
  });
  workbook.write((await archive.file('xl/workbook.xml')?.async('string')) ?? '').close();
  const theme = (await archive.file(themePath)?.async('string')) ?? '';
  const typeface = (font: string, fallback: string) =>
    new RegExp(
      `<(?:[\\w.-]+:)?${font}\\b[^>]*>\\s*<(?:[\\w.-]+:)?latin\\b[^>]*\\btypeface\\s*=\\s*["']([^"']+)["']`,
    ).exec(theme)?.[1] ?? fallback;
  const themeFonts = {
    major: typeface('majorFont', 'Calibri Light'),
    minor: typeface('minorFont', 'Calibri'),
  };
  const styles = await archive.file(stylesPath)?.async('string');
  if (styles) archive.file(stylesPath, engineStyles(styles));
  const strings: string[] = [];
  const shared = await archive.file(sharedPath)?.async('string');
  if (shared) {
    const parser = xmlParser();
    let text = '';
    let reading = false;
    parser.on('opentag', (tag) => {
      if (tag.local === 'si') text = '';
      if (tag.local === 't') reading = true;
    });
    const readSharedText = (chunk: string) => {
      if (reading) text += chunk;
    };
    parser.on('text', readSharedText);
    parser.on('cdata', readSharedText);
    parser.on('closetag', (tag) => {
      if (tag.local === 't') reading = false;
      if (tag.local === 'si') strings.push(text);
    });
    parser.write(shared).close();
  }
  const budget = { remaining: 1024 * 1024, cells: 0 };
  const bounded = new Map<string, { truncated: boolean; gridlines: boolean }>();
  for (const path of new Set(sheetPaths)) {
    const file = archive.file(path);
    if (!file) throw new Error('This workbook has a missing worksheet.');
    const sheet = boundedWorksheet(await file.async('string'), strings, budget);
    archive.file(path, sheet.xml);
    bounded.set(path, sheet);
  }
  return {
    sheets: sheetOrder.map(
      (path) => (path && bounded.get(path)) || { truncated: false, gridlines: true },
    ),
    themeFonts,
  };
}
