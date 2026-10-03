/**
 * PAN-4493 WI-5 — a sent user message that references an image attachment
 * renders a clickable thumbnail under its text, using the attachments route
 * URL from extractAttachmentImageRefs (WI-4) and the shared lightbox (WI-2).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

import { UserMessageRow } from '../messageRows';
import { useImageLightboxStore } from '../../ImageLightbox';
import type { ChatMessage } from '../../chat-types';

function userMessage(text: string): ChatMessage {
  return {
    id: 'msg-1',
    role: 'user',
    text,
    createdAt: '2026-10-03T00:00:00Z',
  };
}

afterEach(() => {
  act(() => useImageLightboxStore.getState().close());
});

describe('UserMessageRow attachment thumbnails', () => {
  it('renders a thumbnail with the attachments route URL for a referenced image', () => {
    const text = 'Here is a screenshot @/home/op/.overdeck/conversation-attachments/conv-a/a.png';
    render(<UserMessageRow message={userMessage(text)} />);

    const img = screen.getByAltText('a.png') as HTMLImageElement;
    expect(img.src).toContain('/api/conversations/conv-a/attachments/a.png');
  });

  it('opens the lightbox with the route URL when the thumbnail is clicked', () => {
    const text = '@/home/op/.overdeck/conversation-attachments/conv-a/a.png';
    render(<UserMessageRow message={userMessage(text)} />);

    fireEvent.click(screen.getByTitle('View a.png'));

    expect(useImageLightboxStore.getState().image).toEqual({
      src: '/api/conversations/conv-a/attachments/a.png',
      alt: 'a.png',
    });
  });

  it('removes the thumbnail when the image fails to load', () => {
    const text = '@/home/op/.overdeck/conversation-attachments/conv-a/a.png';
    render(<UserMessageRow message={userMessage(text)} />);

    fireEvent.error(screen.getByAltText('a.png'));

    expect(screen.queryByTestId('user-message-attachments')).not.toBeInTheDocument();
  });

  it('renders no thumbnail strip for a message without image references', () => {
    render(<UserMessageRow message={userMessage('Just a plain message, no attachments.')} />);

    expect(screen.queryByTestId('user-message-attachments')).not.toBeInTheDocument();
  });
});
