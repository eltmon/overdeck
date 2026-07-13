import { describe, it, expect } from 'vitest';
import {
  validateUploadPayload,
  safeUploadExtension,
  isImageAttachmentPath,
  transformMessageForHarness,
  partitionAttachmentsForModel,
  ALLOWED_ATTACHMENT_EXTENSIONS,
  IMAGE_ATTACHMENT_EXTENSIONS,
} from '../../../../src/lib/overdeck/conversation-message.js';

describe('validateUploadPayload', () => {
  it('accepts a valid UTF-8 .md file', () => {
    const result = validateUploadPayload('notes.md', 'text/markdown', Buffer.from('# Hello', 'utf-8'));
    expect(result).toBeNull();
  });

  it('accepts a valid UTF-8 .txt file', () => {
    const result = validateUploadPayload('notes.txt', 'text/plain', Buffer.from('plain text', 'utf-8'));
    expect(result).toBeNull();
  });

  it('accepts a valid UTF-8 .json file', () => {
    const result = validateUploadPayload('data.json', 'application/json', Buffer.from('{"ok":true}', 'utf-8'));
    expect(result).toBeNull();
  });

  it('rejects a .txt file with invalid UTF-8 bytes', () => {
    const result = validateUploadPayload('bad.txt', 'text/plain', Buffer.from([0xff, 0xfe]));
    expect(result).not.toBeNull();
    expect(result!.status).toBe(400);
    expect(result!.error).toMatch(/content/i);
  });

  it('rejects a .txt file containing a NUL byte', () => {
    const result = validateUploadPayload('bad.txt', 'text/plain', Buffer.from('hello\x00world', 'utf-8'));
    expect(result).not.toBeNull();
    expect(result!.status).toBe(400);
    expect(result!.error).toMatch(/content/i);
  });

  it('accepts a .pdf with %PDF- prefix', () => {
    const result = validateUploadPayload('doc.pdf', 'application/pdf', Buffer.from('%PDF-1.4', 'utf-8'));
    expect(result).toBeNull();
  });

  it('rejects a .pdf without %PDF- prefix', () => {
    const result = validateUploadPayload('doc.pdf', 'application/pdf', Buffer.from('not a pdf', 'utf-8'));
    expect(result).not.toBeNull();
    expect(result!.status).toBe(400);
    expect(result!.error).toMatch(/content/i);
  });

  it('rejects a disallowed extension (.exe)', () => {
    const result = validateUploadPayload('app.exe', 'application/octet-stream', Buffer.from('binary'));
    expect(result).not.toBeNull();
    expect(result!.status).toBe(400);
    expect(result!.error).toContain('.exe');
  });

  it('rejects an extension-less filename', () => {
    const result = validateUploadPayload('README', 'text/plain', Buffer.from('hello', 'utf-8'));
    expect(result).not.toBeNull();
    expect(result!.status).toBe(400);
    expect(result!.error).toContain('text/plain');
  });

  it('rejects an unsupported image MIME type with the legacy error shape', () => {
    const result = validateUploadPayload('img.tiff', 'image/tiff', Buffer.from('any'));
    expect(result).not.toBeNull();
    expect(result!.status).toBe(400);
    expect(result!.error).toBe('Unsupported mimeType: image/tiff');
  });

  it('preserves PNG magic-byte validation', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(validateUploadPayload('img.png', 'image/png', png)).toBeNull();
  });

  it('rejects PNG-declared payload carrying JPEG bytes', () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
    const result = validateUploadPayload('img.png', 'image/png', jpeg);
    expect(result).not.toBeNull();
    expect(result!.status).toBe(400);
    expect(result!.error).toMatch(/content/i);
  });

  it('preserves JPEG magic-byte validation', () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff]);
    expect(validateUploadPayload('img.jpg', 'image/jpeg', jpeg)).toBeNull();
  });

  it('preserves GIF magic-byte validation', () => {
    const gif = Buffer.from([0x47, 0x49, 0x46, 0x38]);
    expect(validateUploadPayload('img.gif', 'image/gif', gif)).toBeNull();
  });

  it('preserves WebP magic-byte validation', () => {
    const webp = Buffer.from([
      0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
    ]);
    expect(validateUploadPayload('img.webp', 'image/webp', webp)).toBeNull();
  });
});

describe('safeUploadExtension', () => {
  it('returns the mapped extension for an image MIME type', () => {
    expect(safeUploadExtension('photo.png', 'image/png')).toBe('.png');
    expect(safeUploadExtension('photo.jpg', 'image/jpeg')).toBe('.jpg');
  });

  it('prefers the original extension when it matches the image MIME mapping', () => {
    expect(safeUploadExtension('photo.jpg', 'image/jpeg')).toBe('.jpg');
    expect(safeUploadExtension('photo.png', 'image/png')).toBe('.png');
  });

  it('normalizes a mismatched JPEG extension to .jpg for image MIME types', () => {
    expect(safeUploadExtension('photo.jpeg', 'image/jpeg')).toBe('.jpg');
  });

  it('returns the original extension for an allowed non-image file', () => {
    expect(safeUploadExtension('notes.md', 'text/markdown')).toBe('.md');
    expect(safeUploadExtension('data.JSON', 'application/json')).toBe('.json');
    expect(safeUploadExtension('doc.pdf', 'application/pdf')).toBe('.pdf');
  });

  it('returns empty string for a disallowed extension', () => {
    expect(safeUploadExtension('app.exe', 'application/octet-stream')).toBe('');
  });

  it('returns empty string for an extension-less filename', () => {
    expect(safeUploadExtension('README', 'text/plain')).toBe('');
  });
});

describe('isImageAttachmentPath', () => {
  it('returns true for image extensions', () => {
    expect(isImageAttachmentPath('/attachments/conv/uuid.png')).toBe(true);
    expect(isImageAttachmentPath('/attachments/conv/uuid.jpg')).toBe(true);
    expect(isImageAttachmentPath('/attachments/conv/uuid.jpeg')).toBe(true);
    expect(isImageAttachmentPath('/attachments/conv/uuid.gif')).toBe(true);
    expect(isImageAttachmentPath('/attachments/conv/uuid.webp')).toBe(true);
  });

  it('returns false for non-image extensions', () => {
    expect(isImageAttachmentPath('/attachments/conv/uuid.md')).toBe(false);
    expect(isImageAttachmentPath('/attachments/conv/uuid.pdf')).toBe(false);
    expect(isImageAttachmentPath('/attachments/conv/uuid.txt')).toBe(false);
  });
});

describe('attachment extension exports', () => {
  it('includes the expected text/code extensions plus .pdf', () => {
    expect(ALLOWED_ATTACHMENT_EXTENSIONS).toContain('.txt');
    expect(ALLOWED_ATTACHMENT_EXTENSIONS).toContain('.md');
    expect(ALLOWED_ATTACHMENT_EXTENSIONS).toContain('.markdown');
    expect(ALLOWED_ATTACHMENT_EXTENSIONS).toContain('.json');
    expect(ALLOWED_ATTACHMENT_EXTENSIONS).toContain('.jsonl');
    expect(ALLOWED_ATTACHMENT_EXTENSIONS).toContain('.log');
    expect(ALLOWED_ATTACHMENT_EXTENSIONS).toContain('.csv');
    expect(ALLOWED_ATTACHMENT_EXTENSIONS).toContain('.tsv');
    expect(ALLOWED_ATTACHMENT_EXTENSIONS).toContain('.yaml');
    expect(ALLOWED_ATTACHMENT_EXTENSIONS).toContain('.yml');
    expect(ALLOWED_ATTACHMENT_EXTENSIONS).toContain('.toml');
    expect(ALLOWED_ATTACHMENT_EXTENSIONS).toContain('.xml');
    expect(ALLOWED_ATTACHMENT_EXTENSIONS).toContain('.html');
    expect(ALLOWED_ATTACHMENT_EXTENSIONS).toContain('.css');
    expect(ALLOWED_ATTACHMENT_EXTENSIONS).toContain('.js');
    expect(ALLOWED_ATTACHMENT_EXTENSIONS).toContain('.jsx');
    expect(ALLOWED_ATTACHMENT_EXTENSIONS).toContain('.ts');
    expect(ALLOWED_ATTACHMENT_EXTENSIONS).toContain('.tsx');
    expect(ALLOWED_ATTACHMENT_EXTENSIONS).toContain('.py');
    expect(ALLOWED_ATTACHMENT_EXTENSIONS).toContain('.sh');
    expect(ALLOWED_ATTACHMENT_EXTENSIONS).toContain('.bash');
    expect(ALLOWED_ATTACHMENT_EXTENSIONS).toContain('.sql');
    expect(ALLOWED_ATTACHMENT_EXTENSIONS).toContain('.diff');
    expect(ALLOWED_ATTACHMENT_EXTENSIONS).toContain('.patch');
    expect(ALLOWED_ATTACHMENT_EXTENSIONS).toContain('.ini');
    expect(ALLOWED_ATTACHMENT_EXTENSIONS).toContain('.conf');
    expect(ALLOWED_ATTACHMENT_EXTENSIONS).toContain('.cfg');
    expect(ALLOWED_ATTACHMENT_EXTENSIONS).toContain('.pdf');
  });

  it('does not include image extensions in the generic allowlist', () => {
    expect(ALLOWED_ATTACHMENT_EXTENSIONS).not.toContain('.png');
    expect(ALLOWED_ATTACHMENT_EXTENSIONS).not.toContain('.jpg');
  });

  it('exports the expected image attachment extensions', () => {
    expect(IMAGE_ATTACHMENT_EXTENSIONS).toContain('.png');
    expect(IMAGE_ATTACHMENT_EXTENSIONS).toContain('.jpg');
    expect(IMAGE_ATTACHMENT_EXTENSIONS).toContain('.jpeg');
    expect(IMAGE_ATTACHMENT_EXTENSIONS).toContain('.gif');
    expect(IMAGE_ATTACHMENT_EXTENSIONS).toContain('.webp');
  });
});

describe('transformMessageForHarness', () => {
  it('uses attachment-generic wording for a non-claude-jsonl harness', () => {
    const message = 'Please review';
    const paths = ['/attachments/conv/uuid.md'];
    const result = transformMessageForHarness(message, 'codex', paths);
    expect(result).toContain('attached files');
    expect(result).not.toContain('attached image files');
    expect(result).toContain('- /attachments/conv/uuid.md');
    expect(result).toContain('Message:\nPlease review');
  });

  it('uses attachment-generic wording when only attachments are present', () => {
    const paths = ['/attachments/conv/uuid.txt'];
    const result = transformMessageForHarness('', 'codex', paths);
    expect(result).toContain('attached files');
    expect(result).not.toContain('attached image files');
    expect(result).toContain('- /attachments/conv/uuid.txt');
  });

  it('passes the message through unchanged for claude-jsonl harnesses', () => {
    const message = 'hello @/attachments/conv/uuid.md';
    expect(transformMessageForHarness(message, 'claude-code', ['/attachments/conv/uuid.md'])).toBe(message);
  });
});

describe('partitionAttachmentsForModel', () => {
  it('keeps all attachments for a vision-capable model', () => {
    const message = 'hello @/a.png and @/b.md';
    const result = partitionAttachmentsForModel(message, ['/a.png', '/b.md'], true);
    expect(result.outboundMessage).toBe(message);
    expect(result.effectiveAttachmentPaths).toEqual(['/a.png', '/b.md']);
    expect(result.droppedImageCount).toBe(0);
  });

  it('strips only image attachments for a non-vision model', () => {
    const message = 'hello @/a.png and @/b.md';
    const result = partitionAttachmentsForModel(message, ['/a.png', '/b.md'], false);
    expect(result.outboundMessage).toBe('hello  and @/b.md');
    expect(result.effectiveAttachmentPaths).toEqual(['/b.md']);
    expect(result.droppedImageCount).toBe(1);
  });

  it('preserves non-image attachment tokens when images are dropped', () => {
    const message = 'check @/notes.md';
    const result = partitionAttachmentsForModel(message, ['/notes.md'], false);
    expect(result.outboundMessage).toBe(message);
    expect(result.effectiveAttachmentPaths).toEqual(['/notes.md']);
    expect(result.droppedImageCount).toBe(0);
  });

  it('reports zero dropped images when there are no images', () => {
    const message = 'check @/a.md @/b.txt';
    const result = partitionAttachmentsForModel(message, ['/a.md', '/b.txt'], false);
    expect(result.outboundMessage).toBe(message);
    expect(result.effectiveAttachmentPaths).toEqual(['/a.md', '/b.txt']);
    expect(result.droppedImageCount).toBe(0);
  });

  it('strips all attachments and returns an empty outbound message for image-only non-vision input', () => {
    const message = '@/a.png @/b.jpg';
    const result = partitionAttachmentsForModel(message, ['/a.png', '/b.jpg'], false);
    expect(result.outboundMessage).toBe('');
    expect(result.effectiveAttachmentPaths).toEqual([]);
    expect(result.droppedImageCount).toBe(2);
  });
});
