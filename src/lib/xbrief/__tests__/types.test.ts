import { describe, expect, expectTypeOf, it } from 'vitest';
import { resolveXBriefItemKind } from '../types.js';
import type { FilesScopeConfidence, ItemReadiness, XBriefItemKind, XBriefItemMetadata } from '../types.js';

describe('xBRIEF item metadata types', () => {
  it('exposes swarm-contract metadata fields', () => {
    const metadata = {
      files_scope: ['src/lib/xbrief/types.ts'],
      files_scope_confidence: 'high',
      verify_commands: ['npm run typecheck'],
      expected_outputs: ['typecheck completes without errors'],
      readiness: 'ready',
      kind: 'docs',
    } satisfies XBriefItemMetadata;

    expectTypeOf(metadata.files_scope_confidence).toEqualTypeOf<FilesScopeConfidence>();
    expectTypeOf(metadata.readiness).toEqualTypeOf<ItemReadiness>();
    expectTypeOf(metadata.kind).toEqualTypeOf<XBriefItemKind>();
  });

  it('keeps item kind optional and defaults omitted kind to backend', () => {
    const metadata = {
      files_scope: ['src/lib/xbrief/types.ts'],
      files_scope_confidence: 'high',
      readiness: 'ready',
    } satisfies XBriefItemMetadata;

    expectTypeOf(metadata).toMatchTypeOf<XBriefItemMetadata>();
    expect(resolveXBriefItemKind(metadata)).toBe('backend');
  });
});
