import { describe, expect, it } from 'vitest';
import {
  collectWorkspaceReapCandidatesFromInspect,
  parseReapDays,
} from '../workspace-reap.js';

describe('workspace reap', () => {
  it('requires --days to be a non-negative integer', () => {
    expect(parseReapDays(undefined)).toBe(7);
    expect(parseReapDays('0')).toBe(0);
    expect(parseReapDays('14')).toBe(14);
    expect(() => parseReapDays('-1')).toThrow('--days must be a non-negative integer');
    expect(() => parseReapDays('1.5')).toThrow('--days must be a non-negative integer');
  });

  it('groups old Created and non-zero Exited workspace containers by compose project', () => {
    const now = Date.parse('2026-05-16T12:00:00.000Z');
    const cutoff = now - 7 * 86_400_000;

    const candidates = collectWorkspaceReapCandidatesFromInspect([
      {
        Id: 'init-id',
        Name: '/panopticon-feature-pan-1140-init-1',
        Created: '2026-05-01T12:00:00.000000000Z',
        Config: {
          Labels: {
            'com.docker.compose.project': 'panopticon-feature-pan-1140',
            'com.docker.compose.project.config_files': '/repo/workspaces/feature-pan-1140/.devcontainer/docker-compose.devcontainer.yml',
            'com.docker.compose.project.working_dir': '/repo/workspaces/feature-pan-1140/.devcontainer',
          },
        },
        State: { Status: 'created', ExitCode: 0 },
      },
      {
        Id: 'server-id',
        Name: '/panopticon-feature-pan-1140-server-1',
        Created: '2026-05-01T12:00:00.000000000Z',
        Config: {
          Labels: {
            'com.docker.compose.project': 'panopticon-feature-pan-1140',
          },
        },
        State: { Status: 'exited', ExitCode: 127 },
      },
      {
        Id: 'healthy-id',
        Name: '/panopticon-feature-pan-1-server-1',
        Created: '2026-05-01T12:00:00.000000000Z',
        Config: {
          Labels: {
            'com.docker.compose.project': 'panopticon-feature-pan-1',
          },
        },
        State: { Status: 'running', ExitCode: 0 },
      },
      {
        Id: 'fresh-id',
        Name: '/panopticon-feature-pan-2-init-1',
        Created: '2026-05-15T12:00:00.000000000Z',
        Config: {
          Labels: {
            'com.docker.compose.project': 'panopticon-feature-pan-2',
          },
        },
        State: { Status: 'created', ExitCode: 0 },
      },
    ], cutoff, now);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      project: 'panopticon-feature-pan-1140',
      issueId: 'pan-1140',
      ageDays: 15,
    });
    expect(candidates[0].reason).toContain('Created');
    expect(candidates[0].reason).toContain('Exited (127)');
    expect(candidates[0].containers.map(container => container.id)).toEqual(['init-id', 'server-id']);
  });
});
