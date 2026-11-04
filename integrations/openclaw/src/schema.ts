/** Tool parameter schemas and the portable-schema guard (PAN-4954 NFR-3, D-6; PAN-4927 W-INT2).
 * Model providers disagree on JSON Schema keywords beyond this small set, so every schema the
 * plugin registers is checked against ALLOWED_SCHEMA_KEYS in tests. */
import type { JsonSchema } from './openclaw-api.js';

export const ALLOWED_SCHEMA_KEYS = ['type', 'properties', 'required', 'items', 'enum', 'description'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function schemaViolations(schema: unknown, path = '$'): string[] {
  if (!isRecord(schema)) return [];
  const violations = Object.keys(schema)
    .filter((key) => !ALLOWED_SCHEMA_KEYS.includes(key))
    .map((key) => `${path}.${key}`);
  if (isRecord(schema.properties)) {
    for (const [name, child] of Object.entries(schema.properties)) {
      violations.push(...schemaViolations(child, `${path}.properties.${name}`));
    }
  }
  if (schema.items !== undefined) violations.push(...schemaViolations(schema.items, `${path}.items`));
  return violations;
}

export const PENDING_PARAMETERS: JsonSchema = { type: 'object', properties: {} };

export const ANSWER_PARAMETERS: JsonSchema = {
  type: 'object',
  properties: {
    item: { type: 'integer', description: 'The item number from overdeck_pending.' },
    ref: { type: 'string', description: 'The 8-character ref shown with that item in overdeck_pending.' },
    choice: { type: 'string', description: 'The answer the user gave, in the form overdeck_pending lists for that item.' },
  },
  required: ['item', 'ref', 'choice'],
};
