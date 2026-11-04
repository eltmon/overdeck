/**
 * PAN-4820 WI-8: spawnRun's backstop refuses Overdeck review and test agents
 * for a Deft issue, and nothing else.
 */
import { describe, expect, it, vi } from 'vitest';
import { assertRoleRunsOnPipeline, DeftPipelineRoleRefusedError } from '../role-refusal.js';

const deft = async () => true;
const overdeck = async () => false;

describe('assertRoleRunsOnPipeline', () => {
  it.each(['review', 'test'])('refuses %s on a Deft issue', async (role) => {
    await expect(assertRoleRunsOnPipeline('pan-1', role, deft)).rejects.toBeInstanceOf(DeftPipelineRoleRefusedError);
    await expect(assertRoleRunsOnPipeline('pan-1', role, deft)).rejects.toThrow(
      `PAN-1 runs on Deft; Overdeck does not spawn a ${role} agent for it`,
    );
  });

  it('allows work on a Deft issue without reading the pipeline for it', async () => {
    const read = vi.fn(deft);

    await expect(assertRoleRunsOnPipeline('PAN-1', 'work', read)).resolves.toBeUndefined();
    expect(read).not.toHaveBeenCalled();
  });

  it('allows review on an Overdeck issue', async () => {
    await expect(assertRoleRunsOnPipeline('PAN-1', 'review', overdeck)).resolves.toBeUndefined();
  });
});
