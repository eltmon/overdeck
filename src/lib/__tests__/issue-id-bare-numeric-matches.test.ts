import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listBareNumericIssueMatches, resolveBareNumericId } from '../issue-id.js';

describe('listBareNumericIssueMatches (PAN-4465)', () => {
  let overdeckHome: string;

  beforeEach(() => {
    overdeckHome = mkdtempSync(join(tmpdir(), 'overdeck-bare-numeric-'));
  });

  afterEach(() => {
    rmSync(overdeckHome, { recursive: true, force: true });
  });

  function writeAgentState(dirName: string, issueId: string): void {
    const dir = join(overdeckHome, 'agents', dirName);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'state.json'), JSON.stringify({ issueId }));
  }

  it('returns an empty array when no agent dir matches', () => {
    expect(listBareNumericIssueMatches('12', overdeckHome)).toEqual([]);
  });

  it('returns the single matching issueId', () => {
    writeAgentState('agent-pan-12', 'PAN-12');

    expect(listBareNumericIssueMatches('12', overdeckHome)).toEqual(['PAN-12']);
  });

  it('returns every matching issueId when more than one agent dir matches', () => {
    writeAgentState('agent-pan-12', 'PAN-12');
    writeAgentState('agent-min-12', 'MIN-12');

    expect(listBareNumericIssueMatches('12', overdeckHome).sort()).toEqual(['MIN-12', 'PAN-12']);
  });

  it('deduplicates when multiple agent dirs share the same issueId', () => {
    writeAgentState('agent-pan-12', 'PAN-12');
    writeAgentState('agent-pan-12-review', 'PAN-12');

    expect(listBareNumericIssueMatches('12', overdeckHome)).toEqual(['PAN-12']);
  });

  it('returns an empty array for non-digit input', () => {
    expect(listBareNumericIssueMatches('PAN-12', overdeckHome)).toEqual([]);
  });

  it('returns an empty array when the agents dir does not exist', () => {
    expect(listBareNumericIssueMatches('12', join(overdeckHome, 'does-not-exist'))).toEqual([]);
  });

  describe('resolveBareNumericId', () => {
    it('returns the single match when exactly one agent dir matches', () => {
      writeAgentState('agent-pan-12', 'PAN-12');

      expect(resolveBareNumericId('12', overdeckHome)).toBe('PAN-12');
    });

    it('returns null when two agent dirs match different issues', () => {
      writeAgentState('agent-pan-12', 'PAN-12');
      writeAgentState('agent-min-12', 'MIN-12');

      expect(resolveBareNumericId('12', overdeckHome)).toBeNull();
    });

    it('returns null when no agent dir matches', () => {
      expect(resolveBareNumericId('12', overdeckHome)).toBeNull();
    });

    it('still resolves non-digit input via resolveIssueId, unaffected by overdeckHome', () => {
      expect(resolveBareNumericId('agent-pan-12', overdeckHome)).toBe('PAN-12');
    });
  });
});
