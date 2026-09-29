import { describe, expect, it } from 'vitest'

import { hasPastedContentWrapper, stripPastedContentWrappers } from '../pasted-content.js'

// Landed record, agent idle (conv 2972 line 3401)
const LANDED_WRAPPED =
  '\n\n<pasted_content id="9469">\nSonnet 5.5 just released!! We need to add that and publish to NPM ASAP!\nFor the WSL related stuff, no.\n</pasted_content id="9469">\n'

// Queued prompt (line 1486 enqueue / 1493 queued_command attachment)
const QUEUED_WRAPPED =
  '<pasted_content id="9469">\n@/tmp/att/ef87.png\nGo ahead and do your recommended order, please.\n</pasted_content id="9469">'

// Typed prefix plus paste (constructed)
const TYPED_PLUS_PASTE = 'see below\n\n<pasted_content id="7">\nline one\nline two\n</pasted_content id="7">\n'

// Paste whose inner text starts with '<' (constructed)
const PASTE_OF_XML = '\n\n<pasted_content id="8">\n<config>\n  <a>1</a>\n</config>\n</pasted_content id="8">\n'

describe('hasPastedContentWrapper', () => {
  it('detects a wrapped landed record', () => {
    expect(hasPastedContentWrapper(LANDED_WRAPPED)).toBe(true)
  })

  it('returns false repeatedly for plain text (no lastIndex state)', () => {
    const plain = 'just a regular message'
    expect(hasPastedContentWrapper(plain)).toBe(false)
    expect(hasPastedContentWrapper(plain)).toBe(false)
  })
})

describe('stripPastedContentWrappers', () => {
  it('strips a landed wrapped record to its inner text', () => {
    expect(stripPastedContentWrappers(LANDED_WRAPPED)).toBe(
      'Sonnet 5.5 just released!! We need to add that and publish to NPM ASAP!\nFor the WSL related stuff, no.',
    )
  })

  it('strips a queued wrapped prompt to its inner text', () => {
    expect(stripPastedContentWrappers(QUEUED_WRAPPED)).toBe(
      '@/tmp/att/ef87.png\nGo ahead and do your recommended order, please.',
    )
  })

  it('preserves a typed prefix alongside the pasted body', () => {
    expect(stripPastedContentWrappers(TYPED_PLUS_PASTE)).toBe('see below\n\nline one\nline two')
  })

  it('preserves an inner body that itself starts with "<"', () => {
    expect(stripPastedContentWrappers(PASTE_OF_XML)).toBe('<config>\n  <a>1</a>\n</config>')
  })

  it('preserves both bodies of a text with two wrapped blocks', () => {
    const twoBlocks =
      'first\n\n<pasted_content id="1">\nblock one\n</pasted_content id="1">\n\nsecond\n\n<pasted_content id="2">\nblock two\n</pasted_content id="2">\n'
    const stripped = stripPastedContentWrappers(twoBlocks)
    expect(stripped).toContain('block one')
    expect(stripped).toContain('block two')
    expect(stripped).not.toContain('pasted_content')
  })

  it('returns plain text unchanged by identity', () => {
    const plain = 'just a regular message'
    expect(stripPastedContentWrappers(plain)).toBe(plain)
  })

  it('removes a closing tag without an id attribute', () => {
    const wrapped = '<pasted_content id="42">\nhello\n</pasted_content>'
    expect(stripPastedContentWrappers(wrapped)).toBe('hello')
  })
})
