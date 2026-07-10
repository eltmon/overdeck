import { describe, expect, it } from 'vitest';
import { shouldCommitLegacyWorkspaceArtifacts } from '../state-home.js';

describe('migrated workspace commit gates', () => {
  it('permits legacy sync only before the completion marker is authoritative', () => {
    expect(shouldCommitLegacyWorkspaceArtifacts(false)).toBe(true);
    expect(shouldCommitLegacyWorkspaceArtifacts(true)).toBe(false);
  });
});
