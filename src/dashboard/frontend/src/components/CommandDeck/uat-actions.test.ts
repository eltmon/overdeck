import { describe, expect, it } from 'vitest';
import { resolveUatActions, type UatIssueLifecycle } from './uat-actions';
import type { UatStackState } from './UatStackStatus';

function ids(result: ReturnType<typeof resolveUatActions>, key: 'inline' | 'menu'): string[] {
  return result[key].map(action => action.id);
}

describe('resolveUatActions', () => {
  it.each([
    ['healthy', 'active', ['open-uat', 'open-api'], ['open-uat', 'open-api', 'logs', 'restart', 'rebuild', 'stop', 'open-state-dir', 'copy-stack-name', 'reap']],
    ['starting', 'active', ['logs'], ['open-uat', 'open-api', 'logs', 'restart', 'rebuild', 'stop', 'open-state-dir', 'copy-stack-name', 'reap']],
    ['unhealthy', 'active', ['logs', 'rebuild'], ['open-uat', 'open-api', 'logs', 'rebuild', 'restart', 'stop', 'open-state-dir', 'copy-stack-name', 'reap']],
    ['stopped', 'idle', ['start', 'reap'], ['logs', 'rebuild', 'open-state-dir', 'copy-stack-name', 'reap']],
    ['stale', 'merged', ['reap'], ['logs', 'start', 'open-state-dir', 'copy-stack-name', 'reap']],
  ] as Array<[UatStackState, UatIssueLifecycle, string[], string[]]>)(
    'returns documented actions for %s/%s',
    (stackState, issueLifecycle, inlineIds, menuIds) => {
      const result = resolveUatActions(stackState, issueLifecycle);
      expect(ids(result, 'inline')).toEqual(inlineIds);
      expect(ids(result, 'menu')).toEqual(menuIds);
      expect(result.menu.at(-1)).toMatchObject({ id: 'reap', tone: 'danger' });
    },
  );

  it('treats merged lifecycle as stale even when the stack state is healthy', () => {
    const result = resolveUatActions('healthy', 'merged');
    expect(ids(result, 'inline')).toEqual(['reap']);
    expect(result.inline[0]).toMatchObject({ label: 'Reap workspace', tone: 'primary' });
  });
});
