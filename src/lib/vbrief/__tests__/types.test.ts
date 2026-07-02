import { describe, expect, expectTypeOf, it } from 'vitest';
import { resolveVBriefItemKind } from '../types.js';
import type { FilesScopeConfidence, ItemReadiness, VBriefItemKind, VBriefItemMetadata } from '../types.js';

describe('vBRIEF item metadata types', () => {
  it('exposes swarm-contract metadata fields', () => {
    const metadata = {
      files_scope: ['src/lib/vbrief/types.ts'],
      files_scope_confidence: 'high',
      verify_commands: ['npm run typecheck'],
      expected_outputs: ['typecheck completes without errors'],
      readiness: 'ready',
      kind: 'docs',
    } satisfies VBriefItemMetadata;

    expectTypeOf(metadata.files_scope_confidence).toEqualTypeOf<FilesScopeConfidence>();
    expectTypeOf(metadata.readiness).toEqualTypeOf<ItemReadiness>();
    expectTypeOf(metadata.kind).toEqualTypeOf<VBriefItemKind>();
  });

  it('keeps item kind optional and defaults omitted kind to backend', () => {
    const metadata = {
      files_scope: ['src/lib/vbrief/types.ts'],
      files_scope_confidence: 'high',
      readiness: 'ready',
    } satisfies VBriefItemMetadata;

    expectTypeOf(metadata).toMatchTypeOf<VBriefItemMetadata>();
    expect(resolveVBriefItemKind(metadata)).toBe('backend');
  });
});
