// Ported from t3code (MIT, Copyright (c) 2026 T3 Tools Inc.)
// upstream: apps/web/src/components/files/officeArchive.ts @ 2d8a843e6b
import { SaxesParser } from 'saxes';

export function xmlParser() {
  const parser = new SaxesParser({ xmlns: true });
  parser.on('doctype', () => {
    throw new Error('This document contains unsupported XML declarations.');
  });
  return parser;
}

export function officeXmlDecoder(bytes: Uint8Array) {
  if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0x3c && bytes[1] === 0))
    return new TextDecoder('utf-16le');
  if ((bytes[0] === 0xfe && bytes[1] === 0xff) || (bytes[0] === 0 && bytes[1] === 0x3c))
    return new TextDecoder('utf-16be');
  const declaration = new TextDecoder().decode(bytes.subarray(0, 256));
  return new TextDecoder(/^<\?xml\s[^?]*\bencoding\s*=\s*["']([^"']+)["']/i.exec(declaration)?.[1]);
}

export function officeXml(bytes: Uint8Array) {
  // Repacked XML is UTF-8, regardless of the source part's encoding.
  return officeXmlDecoder(bytes)
    .decode(bytes)
    .replace(/^(<\?xml\s[^?]*\bencoding\s*=\s*)["'][^"']+["']/i, '$1"UTF-8"');
}
