import { describe, expect, it } from 'vitest';
import { setFrontmatterModel } from '../../src/lib/agent-model-sync.js';

describe('setFrontmatterModel', () => {
  it('replaces the model field and preserves everything else', () => {
    const input = `---
name: codebase-explorer
description: Fast read-only exploration
model: haiku
tools:
  - Read
  - Grep
---

# Body

Content here.
`;
    const output = setFrontmatterModel(input, 'gpt-5.4-mini');
    expect(output).toBe(`---
name: codebase-explorer
description: Fast read-only exploration
model: gpt-5.4-mini
tools:
  - Read
  - Grep
---

# Body

Content here.
`);
  });

  it('is idempotent when the model already matches', () => {
    const input = `---
name: foo
model: sonnet
---
body
`;
    const output = setFrontmatterModel(input, 'sonnet');
    expect(output).toBe(input);
  });

  it('handles model values with dashes, dots, and numbers', () => {
    const input = `---
name: foo
model: haiku
---
body
`;
    const output = setFrontmatterModel(input, 'claude-haiku-4-5-20251001');
    expect(output).toContain('model: claude-haiku-4-5-20251001');
    expect(output).not.toContain('model: haiku\n');
  });

  it('returns null when there is no frontmatter', () => {
    expect(setFrontmatterModel('# just a heading\n', 'sonnet')).toBeNull();
  });

  it('inserts a model field when frontmatter has none', () => {
    const input = `---
name: foo
description: bar
---
body
`;
    expect(setFrontmatterModel(input, 'sonnet')).toBe(`---
name: foo
description: bar
model: sonnet
---
body
`);
  });

  it('returns null when frontmatter is unterminated', () => {
    const input = `---
name: foo
model: haiku
no closing delim
`;
    expect(setFrontmatterModel(input, 'sonnet')).toBeNull();
  });

  it('inserts a frontmatter model and leaves a body model: mention untouched', () => {
    const input = `---
name: foo
description: bar
---
# body

Example: \`model: haiku\`
`;
    const output = setFrontmatterModel(input, 'sonnet');
    expect(output).toBe(`---
name: foo
description: bar
model: sonnet
---
# body

Example: \`model: haiku\`
`);
  });

  it('replaces only the first model field, not any later occurrences in the body', () => {
    const input = `---
name: foo
model: haiku
tools:
  - Read
---

Docs mention model: haiku as an example.
`;
    const output = setFrontmatterModel(input, 'sonnet');
    expect(output).toContain('model: sonnet');
    expect(output).toContain('Docs mention model: haiku as an example.');
  });
});
