import { describe, expect, it } from 'vitest';
import { ANSWER_PARAMETERS, PENDING_PARAMETERS, schemaViolations } from '../src/schema.js';

describe('schemaViolations', () => {
  it('finds nothing in the tool parameter schemas', () => {
    expect(schemaViolations(PENDING_PARAMETERS)).toEqual([]);
    expect(schemaViolations(ANSWER_PARAMETERS)).toEqual([]);
  });

  it('reports each non-portable key with its path', () => {
    const schema = {
      type: 'object',
      additionalProperties: false,
      properties: {
        a: { type: 'string', format: 'uri', anyOf: [] },
        b: { type: 'integer', minimum: 1 },
        c: { type: 'array', items: { type: 'string', const: 'x', oneOf: [] } },
      },
    };
    expect(schemaViolations(schema).sort()).toEqual([
      '$.additionalProperties',
      '$.properties.a.anyOf',
      '$.properties.a.format',
      '$.properties.b.minimum',
      '$.properties.c.items.const',
      '$.properties.c.items.oneOf',
    ]);
  });
});
