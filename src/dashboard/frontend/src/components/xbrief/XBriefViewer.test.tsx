/**
 * Tests for XBriefViewer component suite
 *
 * Covers:
 * - XBriefHeader: title, status badge, uid, author, timestamps
 * - XBriefNarratives: markdown rendering
 * - XBriefReferences: clickable links
 * - XBriefItemCard: expand/collapse, AC checklist with status indicators
 * - XBriefViewer: tab switching (List/DAG/Raw JSON), missing plan fallback
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { XBriefDocument } from './types';
import { XBriefViewer } from './XBriefViewer';
import { XBriefHeader } from './XBriefHeader';
import { XBriefItemCard } from './XBriefItemCard';

// Mock localStorage
const localStorageMock: Record<string, string> = {};
vi.stubGlobal('localStorage', {
  getItem: (k: string) => localStorageMock[k] ?? null,
  setItem: (k: string, v: string) => { localStorageMock[k] = v; },
  removeItem: (k: string) => { delete localStorageMock[k]; },
});

// Mock lucide-react icons to avoid rendering complexity
vi.mock('lucide-react', () => ({
  List: () => null,
  GitBranch: () => null,
  Code2: () => null,
  ExternalLink: () => null,
  ChevronRight: () => null,
  ChevronDown: () => null,
  CheckCircle2: () => null,
  Circle: () => null,
  XCircle: () => null,
  Clock: () => null,
}));

// Mock react-markdown to render content directly
vi.mock('react-markdown', () => ({
  default: ({ children }: { children: string }) => <span data-testid="markdown">{children}</span>,
}));

vi.mock('remark-gfm', () => ({ default: () => {} }));

function makeDoc(overrides: Partial<XBriefDocument['plan']> = {}): XBriefDocument {
  return {
    xBRIEFInfo: {
      version: '0.5',
      created: '2026-01-01T00:00:00Z',
      author: 'overdeck/0.6.0',
      description: 'Plan for TEST-1: Test Issue',
    },
    plan: {
      id: 'test-1',
      title: 'Test Issue Plan',
      status: 'approved',
      uid: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      author: 'agent:claude-opus-4-6',
      sequence: 3,
      created: '2026-01-01T00:00:00Z',
      updated: '2026-02-01T12:00:00Z',
      references: [
        { uri: 'https://github.com/example/repo/issues/1', label: 'TEST-1', type: 'issue' },
      ],
      narratives: {
        Problem: 'The system lacks **feature X**.',
        Proposal: 'Add feature X by doing Y.',
      },
      items: [
        {
          id: 'task-a',
          title: 'Implement feature X',
          status: 'pending',
          priority: 'high',
          metadata: { difficulty: 'medium' },
          narrative: { Action: 'Write the code for feature X.' },
          subItems: [
            { id: 'task-a.ac1', title: 'Feature X works', status: 'completed', metadata: { kind: 'acceptance_criterion' } },
            { id: 'task-a.ac2', title: 'Tests pass', status: 'pending', metadata: { kind: 'acceptance_criterion' } },
          ],
        },
      ],
      edges: [],
      ...overrides,
    },
  };
}

// ─── XBriefViewer: missing plan ───────────────────────────────────────────────

describe('XBriefViewer: missing plan', () => {
  it('shows "No plan available" when doc is null', () => {
    render(<XBriefViewer doc={null} />);
    expect(screen.getByText('No plan available')).toBeTruthy();
  });
});

// ─── XBriefReadinessPanel ────────────────────────────────────────────────────

describe('XBriefViewer: readiness panel', () => {
  it('renders dependency waves, overlap matrix, and conflict groups', () => {
    render(<XBriefViewer doc={makeDoc({
      items: [
        {
          id: 'task-a',
          title: 'Task A',
          status: 'pending',
          metadata: {
            difficulty: 'medium',
            files_scope: ['src/shared.ts'],
            files_scope_confidence: 'high',
            readiness: 'ready',
          },
        },
        {
          id: 'task-b',
          title: 'Task B',
          status: 'pending',
          metadata: {
            difficulty: 'medium',
            files_scope: ['src/shared.ts'],
            files_scope_confidence: 'high',
            readiness: 'ready',
          },
        },
        {
          id: 'task-c',
          title: 'Task C',
          status: 'pending',
          metadata: {
            difficulty: 'medium',
            files_scope: ['src/c.ts'],
            files_scope_confidence: 'high',
            readiness: 'ready',
          },
        },
      ],
      edges: [{ from: 'task-a', to: 'task-c', type: 'blocks' }],
    })} initialTab="list" />);

    expect(screen.getByText('Readiness report')).toBeTruthy();
    expect(screen.getByText('wave 0')).toBeTruthy();
    expect(screen.getByText(': task-a, task-b')).toBeTruthy();
    expect(screen.getByText('wave 1')).toBeTruthy();
    expect(screen.getByText(': task-c')).toBeTruthy();
    expect(screen.getByText('task-a / task-b')).toBeTruthy();
    expect(screen.getAllByText(/src\/shared\.ts/).length).toBeGreaterThan(0);
    expect(screen.getByText('task-a + task-b')).toBeTruthy();
  });
});

// ─── XBriefViewer: tab switching ──────────────────────────────────────────────

describe('XBriefViewer: tab switching', () => {
  beforeEach(() => {
    Object.keys(localStorageMock).forEach(k => delete localStorageMock[k]);
  });

  it('renders List tab by default', () => {
    render(<XBriefViewer doc={makeDoc()} initialTab="list" />);
    expect(screen.getByRole('tab', { name: /list/i })).toBeTruthy();
  });

  it('switches to Raw JSON tab and shows JSON content', () => {
    render(<XBriefViewer doc={makeDoc()} initialTab="list" />);
    const rawTab = screen.getByRole('tab', { name: /raw json/i });
    fireEvent.click(rawTab);
    expect(screen.getByText(/test-1/)).toBeTruthy(); // JSON contains plan.id
  });

  it('accepts a controlled tab while hiding its internal tab bar', () => {
    render(<XBriefViewer doc={makeDoc()} activeTab="raw" showTabBar={false} />);

    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.getByText(/test-1/)).toBeTruthy();
  });

  it('switches to DAG tab', () => {
    render(<XBriefViewer doc={makeDoc()} initialTab="list" />);
    const dagTab = screen.getByRole('tab', { name: /dag/i });
    fireEvent.click(dagTab);
    // DAG tab is selected
    expect(dagTab.getAttribute('aria-selected')).toBe('true');
  });

  it('fills the available viewer height while preserving the DAG minimum height', () => {
    render(<XBriefViewer doc={makeDoc()} initialTab="dag" />);

    const pane = screen.getByTestId('xbrief-dag-pane');
    expect(pane.className).toContain('flex-1');
    expect(pane.className).toContain('min-h-0');
    expect(pane.style.minHeight).toBe('400px');
    expect(pane.style.height).toBe('');
  });

  it('List tab is aria-selected when active', () => {
    render(<XBriefViewer doc={makeDoc()} initialTab="list" />);
    const listTab = screen.getByRole('tab', { name: /list/i });
    expect(listTab.getAttribute('aria-selected')).toBe('true');
  });
});

// ─── XBriefHeader ─────────────────────────────────────────────────────────────

describe('XBriefHeader', () => {
  it('renders plan title', () => {
    render(<XBriefHeader doc={makeDoc()} />);
    expect(screen.getByText('Test Issue Plan')).toBeTruthy();
  });

  it('renders status badge', () => {
    render(<XBriefHeader doc={makeDoc()} />);
    expect(screen.getByText('approved')).toBeTruthy();
  });

  it('renders plan.uid', () => {
    render(<XBriefHeader doc={makeDoc()} />);
    expect(screen.getByText('f47ac10b-58cc-4372-a567-0e02b2c3d479')).toBeTruthy();
  });

  it('renders plan.author', () => {
    render(<XBriefHeader doc={makeDoc()} />);
    expect(screen.getByText('agent:claude-opus-4-6')).toBeTruthy();
  });

  it('renders xBRIEFInfo.author as tool', () => {
    render(<XBriefHeader doc={makeDoc()} />);
    expect(screen.getByText('overdeck/0.6.0')).toBeTruthy();
  });

  it('renders created timestamp', () => {
    render(<XBriefHeader doc={makeDoc()} />);
    // Should render some formatted date for '2026-01-01T00:00:00Z'
    const createdLabel = screen.getByText('created');
    expect(createdLabel).toBeTruthy();
  });

  it('renders updated timestamp', () => {
    render(<XBriefHeader doc={makeDoc()} />);
    const updatedLabel = screen.getByText('updated');
    expect(updatedLabel).toBeTruthy();
  });

  it('renders sequence number', () => {
    render(<XBriefHeader doc={makeDoc()} />);
    expect(screen.getByText('3')).toBeTruthy();
  });

  it('renders default inspection policy', () => {
    render(<XBriefHeader doc={makeDoc()} />);
    expect(screen.getByText('inspection')).toBeTruthy();
    expect(screen.getByText('auto')).toBeTruthy();
  });

  it('allows editing inspection policy', () => {
    const onInspectionPolicyChange = vi.fn();
    render(<XBriefHeader doc={makeDoc()} onInspectionPolicyChange={onInspectionPolicyChange} />);
    fireEvent.change(screen.getByLabelText('Inspection policy'), { target: { value: 'never' } });
    expect(onInspectionPolicyChange).toHaveBeenCalledWith('never');
  });

  it('omits uid row when uid is absent', () => {
    const doc = makeDoc({ uid: undefined });
    render(<XBriefHeader doc={doc} />);
    expect(screen.queryByText(/f47ac10b/)).toBeNull();
  });
});

// ─── XBriefItemCard ───────────────────────────────────────────────────────────

describe('XBriefItemCard', () => {
  it('renders item title', () => {
    const item = makeDoc().plan.items[0];
    render(<XBriefItemCard item={item} />);
    expect(screen.getByText('Implement feature X')).toBeTruthy();
  });

  it('renders priority badge', () => {
    const item = makeDoc().plan.items[0];
    render(<XBriefItemCard item={item} />);
    expect(screen.getByText('high')).toBeTruthy();
  });

  it('renders difficulty badge', () => {
    const item = makeDoc().plan.items[0];
    render(<XBriefItemCard item={item} />);
    expect(screen.getByText('medium')).toBeTruthy();
  });

  it('shows AC count when collapsed', () => {
    const item = makeDoc().plan.items[0];
    render(<XBriefItemCard item={item} />);
    // 1 of 2 ACs completed
    expect(screen.getByText('1/2 AC')).toBeTruthy();
  });

  it('expands to show AC checklist on click', () => {
    const item = makeDoc().plan.items[0];
    render(<XBriefItemCard item={item} />);
    const button = screen.getByRole('button');
    fireEvent.click(button);
    expect(screen.getByText('Feature X works')).toBeTruthy();
    expect(screen.getByText('Tests pass')).toBeTruthy();
  });

  it('shows completed AC text with strikethrough style', () => {
    const item = makeDoc().plan.items[0];
    render(<XBriefItemCard item={item} />);
    fireEvent.click(screen.getByRole('button'));
    const completedAC = screen.getByText('Feature X works');
    expect(completedAC.className).toContain('line-through');
  });
});

// ─── XBriefViewer: list tab content ──────────────────────────────────────────

describe('XBriefViewer: list tab renders full plan', () => {
  it('renders header with plan title', () => {
    render(<XBriefViewer doc={makeDoc()} initialTab="list" />);
    expect(screen.getByText('Test Issue Plan')).toBeTruthy();
  });

  it('renders narrative sections', () => {
    render(<XBriefViewer doc={makeDoc()} initialTab="list" />);
    expect(screen.getByText('Problem')).toBeTruthy();
    expect(screen.getByText('Proposal')).toBeTruthy();
  });

  it('renders references', () => {
    render(<XBriefViewer doc={makeDoc()} initialTab="list" />);
    expect(screen.getByText('TEST-1')).toBeTruthy();
  });

  it('renders items list', () => {
    render(<XBriefViewer doc={makeDoc()} initialTab="list" />);
    expect(screen.getByText('Implement feature X')).toBeTruthy();
  });
});
