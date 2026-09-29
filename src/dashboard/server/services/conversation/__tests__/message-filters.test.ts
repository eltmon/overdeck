import { describe, expect, it } from 'vitest';

import { renderableUserText } from '../message-filters.js';

// Landed record, agent idle (conv 2972 line 3401)
const LANDED_WRAPPED =
  '\n\n<pasted_content id="9469">\nSonnet 5.5 just released!! We need to add that and publish to NPM ASAP!\nFor the WSL related stuff, no.\n</pasted_content id="9469">\n';

// Queued prompt (line 1486 enqueue / 1493 queued_command attachment)
const QUEUED_WRAPPED =
  '<pasted_content id="9469">\n@/tmp/att/ef87.png\nGo ahead and do your recommended order, please.\n</pasted_content id="9469">';

// Paste whose inner text starts with '<' (constructed)
const PASTE_OF_XML = '\n\n<pasted_content id="8">\n<config>\n  <a>1</a>\n</config>\n</pasted_content id="8">\n';

describe('renderableUserText — pasted_content unwrap (PAN-4305)', () => {
  it('renders a landed wrapped record as its inner text', () => {
    expect(renderableUserText(LANDED_WRAPPED)).toBe(
      'Sonnet 5.5 just released!! We need to add that and publish to NPM ASAP!\nFor the WSL related stuff, no.',
    );
  });

  it('renders a queued wrapped prompt as its inner text', () => {
    expect(renderableUserText(QUEUED_WRAPPED)).toBe(
      '@/tmp/att/ef87.png\nGo ahead and do your recommended order, please.',
    );
  });

  it('renders a paste whose inner text starts with "<"', () => {
    expect(renderableUserText(PASTE_OF_XML)).toBe('<config>\n  <a>1</a>\n</config>');
  });

  it('still hides a plain system-reminder injection', () => {
    expect(renderableUserText('<system-reminder>x</system-reminder>')).toBeNull();
  });

  it('hides a system-reminder whose body contains a pasted_content block', () => {
    const wrapped =
      '<system-reminder>\n<pasted_content id="1">\nquoted paste\n</pasted_content id="1">\n</system-reminder>';
    expect(renderableUserText(wrapped)).toBeNull();
  });

  it('still unwraps a plain <channel> message', () => {
    expect(renderableUserText('<channel source="x">\nhi\n</channel>')).toBe('hi');
  });

  it('returns plain text unchanged', () => {
    const plain = 'just a regular message';
    expect(renderableUserText(plain)).toBe(plain);
  });
});
