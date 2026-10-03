import { describe, expect, it } from 'vitest';

import { extractAttachmentImageRefs } from '../helpers';

// PAN-4493 WI-4: image attachments a user message references, so the sent-message
// thumbnail strip (WI-5) knows which route URL to render for each one.

describe('extractAttachmentImageRefs', () => {
  it('finds an @-prefixed reference', () => {
    const text = '@/home/op/.overdeck/conversation-attachments/conv-a/a.png';
    expect(extractAttachmentImageRefs(text)).toEqual([
      { conversationName: 'conv-a', file: 'a.png', url: '/api/conversations/conv-a/attachments/a.png' },
    ]);
  });

  it('finds a bare "- /path" reference (non-Claude harness form)', () => {
    const text = '- /home/op/.overdeck/conversation-attachments/conv-a/a.png';
    expect(extractAttachmentImageRefs(text)).toEqual([
      { conversationName: 'conv-a', file: 'a.png', url: '/api/conversations/conv-a/attachments/a.png' },
    ]);
  });

  it('finds several references in order and drops duplicates', () => {
    const text = [
      '@/home/op/.overdeck/conversation-attachments/conv-a/a.png',
      '@/home/op/.overdeck/conversation-attachments/conv-b/b.jpg',
      '@/home/op/.overdeck/conversation-attachments/conv-a/a.png',
    ].join(' ');
    expect(extractAttachmentImageRefs(text)).toEqual([
      { conversationName: 'conv-a', file: 'a.png', url: '/api/conversations/conv-a/attachments/a.png' },
      { conversationName: 'conv-b', file: 'b.jpg', url: '/api/conversations/conv-b/attachments/b.jpg' },
    ]);
  });

  it('ignores non-image attachments (.pdf, .md)', () => {
    const text = [
      '@/home/op/.overdeck/conversation-attachments/conv-a/notes.pdf',
      '@/home/op/.overdeck/conversation-attachments/conv-a/readme.md',
    ].join(' ');
    expect(extractAttachmentImageRefs(text)).toEqual([]);
  });

  it('ignores paths outside conversation-attachments', () => {
    const text = '@/home/op/.overdeck/some-other-dir/conv-a/a.png';
    expect(extractAttachmentImageRefs(text)).toEqual([]);
  });
});
