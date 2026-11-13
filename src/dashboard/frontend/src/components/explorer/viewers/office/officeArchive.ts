// Ported from t3code (MIT, Copyright (c) 2026 T3 Tools Inc.)
// upstream: apps/web/src/components/files/officeArchive.ts @ 2d8a843e6b
import JSZip from 'jszip';

import { checkZipDirectory } from '../binary/zipDirectory';
import { OFFICE_PREVIEW_MAX_BYTES, type OfficeWorkerRequest } from './officePreviewProtocol';
import { officeXml, officeXmlDecoder, xmlParser } from './officeXml';
import { boundWorkbook } from './sheetArchive';
import {
  joinWordBatches,
  WORD_DISABLED_PARTS,
  WORD_LIMITS,
  wordDocuments,
  wordExpansion,
  wordPartTypes,
  wordSections,
  wordXmlCost,
} from './wordArchive';

export { WORD_LIMITS };

// Stream each entry before handing it to an engine. A tiny compressed archive
// must not turn into an unbounded allocation on the UI thread.
export async function boundedArchive(input: Extract<OfficeWorkerRequest, { type: 'open' }>) {
  const { bytes } = input;
  const spreadsheet = input.kind === 'xlsx';
  if (bytes.byteLength > OFFICE_PREVIEW_MAX_BYTES)
    throw new Error('Preview limited to files under 50 MB.');
  checkZipDirectory(bytes);
  const source = await JSZip.loadAsync(bytes).catch(() => {
    throw new Error('This file is damaged, encrypted, or not a valid Office document.');
  });
  const allEntries = Object.values(source.files);
  if (allEntries.length > 2048)
    throw new Error('This file contains too many archive entries to preview.');
  const entries = allEntries.filter((entry) => !entry.dir);
  if (
    input.kind === 'docx' &&
    entries.some((entry) => entry.name.includes('\\') || entry.name.startsWith('/'))
  )
    throw new Error('Preview limited: this Word document has unsupported archive paths.');
  const archive = new JSZip();
  const partTypes = wordPartTypes();
  // Metadata must be bounded and classified before any payload gets a media exemption.
  if (input.kind === 'docx')
    entries.sort(
      (a, b) =>
        Number(b.name === '[Content_Types].xml' || b.name.endsWith('.rels')) -
        Number(a.name === '[Content_Types].xml' || a.name.endsWith('.rels')),
    );
  const costs = new Map<string, { bytes: number; markup: number }>();
  const mediaSizes = new Map<string, number>();
  let total = 0;
  let wordAuxiliaryMarkup = 0;
  let wordInputTruncated = false;
  let word: ReturnType<typeof wordDocuments> | null = null;
  for (const entry of entries) {
    const document = input.kind === 'docx' && entry.name === 'word/document.xml';
    const media = input.kind === 'docx' && partTypes.binary(entry.name);
    const chunks: Uint8Array[] = [];
    const sections = document ? wordSections() : null;
    let decoder: TextDecoder | undefined;
    let length = 0;
    await new Promise<void>((resolve, reject) => {
      // JSZip exposes this streaming API at runtime but omits it from its types.
      const stream = (
        entry as JSZip.JSZipObject & {
          internalStream(type: 'uint8array'): JSZip.JSZipStreamHelper<Uint8Array>;
        }
      ).internalStream('uint8array');
      stream
        .on('data', (chunk: Uint8Array) => {
          total += chunk.length;
          length += chunk.length;
          if (total > (spreadsheet ? 128 * 1024 * 1024 : OFFICE_PREVIEW_MAX_BYTES)) {
            stream.pause();
            reject(new Error('The expanded document is too large to preview safely.'));
            return;
          }
          try {
            if (sections) {
              decoder ??= officeXmlDecoder(chunk);
              sections.write(decoder.decode(chunk, { stream: true }));
            }
          } catch (cause) {
            stream.pause();
            reject(cause);
            return;
          }
          if (document && length > 4 * 1024 * 1024) {
            const kept = Math.max(0, chunk.length - (length - 4 * 1024 * 1024));
            if (kept) chunks.push(chunk.subarray(0, kept));
            wordInputTruncated = true;
            return;
          }
          // Media is bounded independently. Even renamed auxiliary XML must
          // stay small before the engine parses it.
          if (input.kind === 'docx' && !document && !media) {
            for (const byte of chunk) if (byte === 0x3c) wordAuxiliaryMarkup++;
            if (
              length > WORD_LIMITS.auxiliaryPartBytes ||
              wordAuxiliaryMarkup > WORD_LIMITS.auxiliaryMarkup
            ) {
              stream.pause();
              reject(
                new Error('Preview limited: this Word document has too much auxiliary markup.'),
              );
              return;
            }
          }
          if (
            total > (spreadsheet ? 128 * 1024 * 1024 : OFFICE_PREVIEW_MAX_BYTES) ||
            (spreadsheet && total > Math.max(bytes.byteLength * 200, 8 * 1024 * 1024)) ||
            (!document &&
              (spreadsheet || media || entry.name.endsWith('.xml')) &&
              length > (spreadsheet ? 64 * 1024 * 1024 : 8 * 1024 * 1024))
          ) {
            stream.pause();
            reject(new Error('The expanded document is too large to preview safely.'));
          } else chunks.push(chunk);
        })
        .on('error', reject)
        .on('end', resolve)
        .resume();
    });
    const content = new Uint8Array(document ? Math.min(length, 4 * 1024 * 1024) : length);
    let offset = 0;
    for (const chunk of chunks) {
      content.set(chunk, offset);
      offset += chunk.length;
    }
    if (document) {
      sections!.write(decoder?.decode() ?? '');
      word = wordDocuments(officeXml(content), wordInputTruncated, sections!.finish());
      archive.file(entry.name, word.documents[0]!);
    } else if (input.kind === 'docx' && !media) {
      let xml = officeXml(content);
      if (entry.name === '[Content_Types].xml' || entry.name.endsWith('.rels'))
        xml = partTypes.metadata(entry.name, xml);
      const roles = partTypes.roles.get(entry.name);
      let cost = wordXmlCost(xml, roles);
      // The renderer parses related parts even when their render option is off.
      if (roles && [...roles].every((role) => WORD_DISABLED_PARTS.has(role))) continue;
      // Picture bullets come out, and their list levels keep the text bullets Word falls back to.
      if (roles?.has('numbering') && cost.pictures.length > 0) {
        for (const range of [...cost.pictures].reverse())
          xml = xml.slice(0, range.start) + xml.slice(range.end);
        cost = wordXmlCost(xml, roles);
        wordInputTruncated = true;
      }
      if (
        (roles?.has('styles') &&
          (cost.bytes > WORD_LIMITS.styleBytes || cost.markup > WORD_LIMITS.styleUnits)) ||
        (roles?.has('numbering') &&
          (cost.bytes > WORD_LIMITS.numberingBytes || cost.markup > WORD_LIMITS.numberingMarkup))
      ) {
        wordInputTruncated = true;
        continue;
      }
      costs.set(entry.name, cost);
      archive.file(entry.name, xml);
    } else {
      if (input.kind === 'docx' && partTypes.roles.get(entry.name)?.has('font')) {
        continue;
      }
      if (media) mediaSizes.set(entry.name, Math.ceil((content.length * 4) / 3));
      archive.file(entry.name, /\.(?:xml|rels)$/i.test(entry.name) ? officeXml(content) : content);
    }
  }
  if (word) {
    const expansion = await wordExpansion(archive, partTypes, mediaSizes, costs, word.documents);
    wordInputTruncated ||= expansion.truncated;
    for (const path of expansion.omitted) {
      archive.remove(path);
      costs.delete(path);
    }
    let mediaBytes = 0;
    const usedImages = new Set<string>();
    const auxiliary = [...costs.values()].reduce(
      (sum, cost) => ({ bytes: sum.bytes + cost.bytes, markup: sum.markup + cost.markup }),
      { bytes: 0, markup: 0 },
    );
    // The worker engine parses shared parts once, rather than once per legacy render batch.
    let bytes = auxiliary.bytes;
    let markup = auxiliary.markup;
    const documents: string[] = [];
    for (const document of word.documents) {
      const rawCost = wordXmlCost(document, undefined);
      const extra = expansion.costs.get(document)!;
      const cost = { bytes: rawCost.bytes + extra.bytes, markup: rawCost.markup + extra.markup };
      const images = extra.media;
      const batchImages = new Set(extra.images);
      if (
        bytes + cost.bytes > WORD_LIMITS.expandedBytes ||
        markup + cost.markup > WORD_LIMITS.expandedMarkup ||
        mediaBytes + images > OFFICE_PREVIEW_MAX_BYTES
      )
        break;
      bytes += cost.bytes;
      markup += cost.markup;
      mediaBytes += images;
      for (const path of batchImages) usedImages.add(path);
      documents.push(document);
    }
    if (documents.length === 0)
      throw new Error('Preview limited: this Word document has too much expanded markup.');
    word.truncated ||= wordInputTruncated || documents.length < word.documents.length;
    word.documents = documents;
    for (const path of mediaSizes.keys()) if (!usedImages.has(path)) archive.remove(path);
    archive.file('word/document.xml', documents[0]!);
  }
  const workbook = input.kind === 'xlsx' ? await boundWorkbook(archive) : undefined;
  return { archive, word, workbook };
}

export async function prepareOffice(
  bytes: ArrayBuffer,
  kind: Extract<OfficeWorkerRequest, { type: 'open' }>['kind'],
) {
  const result = await boundedArchive({ type: 'open', kind, bytes });
  const root =
    kind === 'docx'
      ? 'word/document.xml'
      : kind === 'xlsx'
        ? 'xl/workbook.xml'
        : 'ppt/presentation.xml';
  if (!result.archive.file(root))
    throw new Error('This is not a valid Office Open XML file. Encrypted files are not supported.');
  if (result.word) {
    const references = new Map<string, string>();
    const relationships = xmlParser();
    relationships.on('opentag', (tag) => {
      if (tag.local !== 'Relationship') return;
      const type = tag.attributes.Type?.value ?? '';
      const target = tag.attributes.Target?.value ?? '';
      const path = new URL(target, 'https://docx.invalid/word/').pathname.slice(1);
      if (result.archive.file(path))
        references.set(tag.attributes.Id?.value ?? '', type.slice(type.lastIndexOf('/') + 1));
    });
    const relationshipXml = await result.archive
      .file('word/_rels/document.xml.rels')
      ?.async('string');
    if (relationshipXml) relationships.write(relationshipXml).close();
    let xml = joinWordBatches(result.word.documents);
    const removed: { start: number; end: number }[] = [];
    const parser = xmlParser();
    let start = -1;
    // Bounded parts can be omitted; dangling story references otherwise reject the entire body in the engine.
    parser.on('opentag', (tag) => {
      if (tag.local !== 'headerReference' && tag.local !== 'footerReference') return;
      const id = Object.values(tag.attributes).find((attr) => attr.local === 'id')?.value ?? '';
      if (references.get(id) !== tag.local.replace('Reference', ''))
        start = xml.lastIndexOf('<', parser.position - 1);
    });
    parser.on('closetag', (tag) => {
      if (start >= 0 && (tag.local === 'headerReference' || tag.local === 'footerReference')) {
        removed.push({ start, end: parser.position });
        start = -1;
      }
    });
    parser.write(xml).close();
    for (const range of [...removed].reverse())
      xml = xml.slice(0, range.start) + xml.slice(range.end);
    result.archive.file(root, xml);
  }
  return {
    bytes: await result.archive.generateAsync({ type: 'arraybuffer', compression: 'STORE' }),
    truncated:
      result.word?.truncated || result.workbook?.sheets.some((sheet) => sheet.truncated) || false,
    view: result.workbook && {
      hiddenGridlines: result.workbook.sheets.flatMap((sheet, index) =>
        sheet.gridlines ? [] : [index],
      ),
      themeFonts: result.workbook.themeFonts,
    },
  };
}
