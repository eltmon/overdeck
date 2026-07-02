import { describe, expectTypeOf, it } from 'vitest';
import type { FilesScopeConfidence, ItemReadiness, VBriefItemKind, VBriefItemMetadata } from '../types.js';

describe('vBRIEF item metadata types', () => {
  it('exposes swarm-contract metadata fields', () => {
    const metadata = {
      kind: 'docs',
      files_scope: ['src/lib/vbrief/types.ts'],
      files_scope_confidence: 'high',
      verify_commands: ['npm run typecheck'],
      expected_outputs: ['typecheck completes without errors'],
      readiness: 'ready',
    } satisfies VBriefItemMetadata;

    expectTypeOf(metadata.kind).toEqualTypeOf<'docs'>();
    expectTypeOf(metadata.files_scope_confidence).toEqualTypeOf<FilesScopeConfidence>();
    expectTypeOf(metadata.readiness).toEqualTypeOf<ItemReadiness>();
  });

  it('keeps item kind optional', () => {
    const metadata = {
      files_scope: ['src/lib/vbrief/types.ts'],
    } satisfies VBriefItemMetadata;

    expectTypeOf(metadata).toMatchTypeOf<VBriefItemMetadata>();
    expectTypeOf<VBriefItemMetadata['kind']>().toEqualTypeOf<VBriefItemKind | undefined>();
  });
});
