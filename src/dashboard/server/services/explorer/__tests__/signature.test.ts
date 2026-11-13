import { describe, expect, it } from 'vitest';
import {
  DiskSignatureBuilder,
  diskSignature,
  diskSignatureLength,
  utf8ByteSizeCanDecodeToLength,
  writtenContentDiskSignature,
} from '../signature.js';

// Vectors computed from Orca's disk-baseline-signature.ts @ c6b9ac9549b on 2026-11-13.
describe('diskSignature', () => {
  it.each([
    ['', '811c9dc5-50c5d1f-0'],
    ['a', 'e40c292c-292375ea-1'],
    ['hello\n', 'f8934173-6cae28a5-6'],
    ['héllo wörld\n', 'd01bb24-ad2f8f9a-c'],
    ['😀', 'cb31c4b8-60d25212-2'],
  ])('signs %j as %s', (input, expected) => {
    expect(diskSignature(input)).toBe(expected);
  });

  it('gives the same signature when fed in pieces', () => {
    expect(new DiskSignatureBuilder().update('hel').update('lo\n').digest()).toBe('f8934173-6cae28a5-6');
  });

  it('signs a lone surrogate as the U+FFFD that a UTF-8 write stores', () => {
    expect(writtenContentDiskSignature('a\uD800b')).toBe(diskSignature('a�b'));
    expect(writtenContentDiskSignature('a\uD800b')).toBe('b94649b3-8a58c155-3');
  });

  it('reads the length back out of a signature', () => {
    expect(diskSignatureLength('f8934173-6cae28a5-6')).toBe(6);
    expect(diskSignatureLength('nope')).toBeNull();
  });

  it('bounds UTF-8 byte size by decoded length', () => {
    expect(utf8ByteSizeCanDecodeToLength(6, 6)).toBe(true);
    expect(utf8ByteSizeCanDecodeToLength(5, 6)).toBe(false);
    expect(utf8ByteSizeCanDecodeToLength(19, 6)).toBe(false);
  });
});
