import { describe, it, expect } from 'vitest';
import { validateUploadPayload } from '../conversation-message.js';

const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

describe('validateUploadPayload', () => {
  it('accepts a valid image with an allowed extension', () => {
    const result = validateUploadPayload('photo.png', 'image/png', PNG_BYTES);
    expect(result).toBeNull();
  });

  it('rejects dotfiles even when they declare an image MIME type', () => {
    const result = validateUploadPayload('.env', 'image/png', PNG_BYTES);
    expect(result).toEqual({ error: 'Dotfiles are not supported', status: 400 });
  });

  it('rejects extensionless files even when they declare an image MIME type', () => {
    const result = validateUploadPayload('Makefile', 'image/png', PNG_BYTES);
    expect(result).toEqual({ error: 'Extensionless files are not supported', status: 400 });
  });
});
