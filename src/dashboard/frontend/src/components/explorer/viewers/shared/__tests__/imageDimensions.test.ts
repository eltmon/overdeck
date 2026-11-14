/** PAN-5189 WI-2: readImageDimensions detects a PNG header and rejects bytes too short to hold one. */
import { describe, expect, it } from 'vitest';

import { readImageDimensions } from '../imageDimensions';

function onePixelPng(): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, 1);
  view.setUint32(20, 1);
  return bytes;
}

describe('readImageDimensions', () => {
  it('reads width and height from a 1x1 PNG header', () => {
    expect(readImageDimensions(onePixelPng())).toEqual({ width: 1, height: 1 });
  });

  it('returns null for bytes too short to hold a PNG header', () => {
    expect(readImageDimensions(new Uint8Array(16))).toBeNull();
  });
});
