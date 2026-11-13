// @vitest-environment jsdom
/** PAN-5189 WI-5: sanitizeDocumentHtml strips scripts/handlers/remote images, and the iframe stays sandboxed.
 *  DOMPurify needs jsdom: the project's default happy-dom environment silently skips its tag/attribute removal. */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import DocumentPages, { sanitizeDocumentHtml } from '../DocumentPages';

describe('sanitizeDocumentHtml', () => {
  it('strips scripts, event handlers and remote images, keeping a data: image', () => {
    const result = sanitizeDocumentHtml(
      '<p onclick="x()">a</p><script>alert(1)</script><img src="https://e.com/a.png"><img src="data:image/png;base64,AAAA">',
    );
    expect(result).not.toContain('script');
    expect(result).not.toContain('onclick');
    expect(result).not.toContain('https:');
    expect(result.match(/<img/g)?.length).toBe(1);
  });
});

describe('DocumentPages', () => {
  it('renders an unsandboxed-script iframe with the document CSP', async () => {
    render(<DocumentPages html="<p>hi</p>" name="Doc" />);
    const frame = await screen.findByTitle('Doc');
    expect(frame.tagName).toBe('IFRAME');
    expect(frame.getAttribute('sandbox')).toBe('');
    expect(frame.getAttribute('srcdoc')).toContain("default-src 'none'");
  });

  it('allows same-origin access without scripts when rendering output', async () => {
    render(<DocumentPages html="<p>hi</p>" name="Doc" output />);
    const frame = await screen.findByTitle('Doc');
    expect(frame.getAttribute('sandbox')).toBe('allow-same-origin');
    expect(frame.getAttribute('sandbox')).not.toContain('allow-scripts');
  });
});
