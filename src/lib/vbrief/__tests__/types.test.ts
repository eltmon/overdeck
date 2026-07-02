import { describe, expectTypeOf, it } from 'vitest';
import { resolveVBriefItemKind } from '../types.js';
import type { FilesScopeConfidence, ItemReadiness, VBriefItemKind, VBriefItemMetadata } from '../types.js';

describe('vBRIEF item metadata types', () => {
  it('exposes swarm-contract metadata fields', () => {
    const metadata = {
      files_scope: ['src/lib/vbrief/types.ts'],
      files_scope_confidence: 'high',
      kind: 'docs',
      verify_commands: ['npm run typecheck'],
      expected_outputs: ['typecheck completes without errors'],
      readiness: 'ready',
    } satisfies VBriefItemMetadata;

    expectTypeOf(metadata.files_scope_confidence).toEqualTypeOf<FilesScopeConfidence>();
    expectTypeOf(metadata.kind).toEqualTypeOf<'docs'>();
    expectTypeOf(metadata.readiness).toEqualTypeOf<ItemReadiness>();
  });

  it('keeps kind optional and defaults missing metadata to backend', () => {
    const metadata = {
      files_scope: ['src/lib/vbrief/types.ts'],
      files_scope_confidence: 'high',
      verify_commands: ['npm run typecheck'],
      expected_outputs: ['typecheck completes without errors'],
      readiness: 'ready',
    } satisfies VBriefItemMetadata;

    const kind = resolveVBriefItemKind(metadata);

    expectTypeOf(kind).toEqualTypeOf<VBriefItemKind>();
    expect(kind).toBe('backend');
  });
});
