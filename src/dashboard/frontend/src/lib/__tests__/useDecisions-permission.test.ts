/**
 * PAN-4278 — a conversation whose feed row carries `pendingPermission` is a
 * blocking permissionRequest decision, timed from the prompt's `since`.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useDashboardStore } from '../store';
import { useDecisions, usePendingInputSubjects, type ConversationPendingInputRow } from '../useDecisions';

function permissionRow(name: string, since: string, agentLabel = 'Subagent: Research Orca onboarding flow'): ConversationPendingInputRow {
  return {
    name,
    title: `Title ${name}`,
    pendingPermission: {
      signature: `sig-${name}`,
      answerable: true,
      agentLabel,
      agentKey: 'a9ef',
      toolName: 'Bash',
      header: 'Bash command',
      clipped: false,
      inputPreview: null,
      detailLines: ['rm -f queue/*'],
      reason: null,
      options: [{ choice: 'allow-once', label: 'Yes' }, { choice: 'deny', label: 'No' }],
      since,
    },
  };
}

function renderWithRows<T>(hook: () => T, rows: ConversationPendingInputRow[]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  queryClient.setQueryData(['conv-ask-user-question'], rows);
  return renderHook(hook, {
    wrapper: ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: queryClient }, children),
  });
}

beforeEach(() => {
  useDashboardStore.setState({
    agentsById: {},
    channelPermissionRequestsById: {},
    issuesRaw: [],
  } as Parameters<typeof useDashboardStore.setState>[0]);
});

describe('pendingPermission decisions', () => {
  it('a conversation with pendingPermission appears in Needs you as permissionRequest', () => {
    const { result } = renderWithRows(() => usePendingInputSubjects(), [permissionRow('conv-a', '2026-09-27T15:32:21.000Z')]);
    expect(result.current).toEqual([expect.objectContaining({
      agentId: 'conv-a',
      source: 'conversation',
      kinds: ['permissionRequest'],
      permissionSummary: 'Subagent: Research Orca onboarding flow · Bash',
      since: '2026-09-27T15:32:21.000Z',
    })]);
  });

  it('useDecisions marks it blocking with the agent · tool summary', () => {
    const { result } = renderWithRows(() => useDecisions(), [permissionRow('conv-a', '2026-09-27T15:32:21.000Z', 'Main agent')]);
    expect(result.current[0]).toMatchObject({
      id: 'conv-a',
      kinds: ['permissionRequest'],
      blocking: true,
      permissionSummary: 'Main agent · Bash',
      since: '2026-09-27T15:32:21.000Z',
    });
  });

  it('oldest permission sorts first', () => {
    const { result } = renderWithRows(() => useDecisions(), [
      permissionRow('conv-new', '2026-09-27T22:00:00.000Z'),
      permissionRow('conv-old', '2026-09-27T15:32:21.000Z'),
    ]);
    expect(result.current.map((d) => d.id)).toEqual(['conv-old', 'conv-new']);
  });
});
