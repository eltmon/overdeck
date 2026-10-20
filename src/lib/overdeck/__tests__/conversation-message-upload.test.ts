import { describe, it, expect } from 'vitest';
import { transformMessageForHarness, validateUploadPayload } from '../conversation-message.js';

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

describe('transformMessageForHarness reads attachmentDelivery (PAN-4562)', () => {
  const attachment = '/home/u/.overdeck/conversation-attachments/c1/abc.png';

  it('returns the message unchanged for a harness with native attachments (claude-code)', () => {
    const message = `see @${attachment}`;
    expect(transformMessageForHarness(message, 'claude-code', [attachment])).toBe(message);
  });

  it.each(['codex', 'ohmypi', 'kimi-code', 'muse'] as const)('inlines attachment paths for %s', (harness) => {
    expect(transformMessageForHarness(`see @${attachment}`, harness, [attachment])).toBe(
      `Use the Read tool to inspect these attached files:\n- ${attachment}\n\nMessage:\nsee`,
    );
  });
});
