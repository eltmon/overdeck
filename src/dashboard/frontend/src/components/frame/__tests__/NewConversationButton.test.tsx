/**
 * PAN-5293 WI-9: the left column's New conversation split button and the N
 * shortcut it owns.
 */
import { useEffect } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NewConversationButton } from '../NewConversationButton';
import { useNewConversationDefaults } from '../deck/newConversationDefaults';
import { installShortcutListener, resetShortcutsForTests } from '../../../lib/shortcuts/registry';
import { NO_PROJECT_KEY } from '../../CommandDeck/projectsData';

const create = vi.fn();
vi.mock('../deck/useCreateConversation', () => ({ useCreateConversation: () => ({ create, createForAgent: vi.fn() }) }));

// PAN-5335 WI-8: the button's second line reads the model catalog. Keep it
// synchronous and off the real catalog fetch with the same FALLBACK_GROUPS
// every other picker falls back to before the catalog resolves.
vi.mock('../../shared/ModelPicker', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../shared/ModelPicker')>();
  return {
    ...actual,
    useAvailableModels: () => ({
      groups: actual.FALLBACK_GROUPS,
      compactionModel: actual.FALLBACK_COMPACTION_MODEL,
      authModes: {},
      harnessPolicy: {},
      defaultModel: 'claude-opus-5-5',
    }),
  };
});

const openDialog = vi.fn();
vi.mock('../../newConversation/newConversationDialogStore', () => ({
  openNewConversationDialog: (opts?: { projectKey?: string }) => openDialog(opts),
}));

// The pickers are covered by their own tests; this stub shows which values
// and setters the button binds to them.
vi.mock('../../CommandDeck/NewConversationPickers', () => ({
  NewConversationPickers: (props: {
    model: string; harness: string; effort: string;
    onModelChange: (m: string) => void; onHarnessChange: (h: string) => void; onEffortChange: (e: string) => void;
  }) => (
    <>
      <button data-testid="model-picker" onClick={() => props.onModelChange('m2')}>{props.model}</button>
      <button data-testid="harness-picker" onClick={() => props.onHarnessChange('codex')}>{props.harness}</button>
      <button data-testid="effort-chip" onClick={() => props.onEffortChange('low')}>{props.effort}</button>
      <button aria-label="Pipeline retrospective">retro</button>
    </>
  ),
}));

function Harness({ selectedProject }: { selectedProject: string | null }) {
  useEffect(() => installShortcutListener(), []);
  return <NewConversationButton selectedProject={selectedProject} collapsed={false} />;
}

beforeEach(() => {
  create.mockClear();
  openDialog.mockClear();
  resetShortcutsForTests();
  useNewConversationDefaults.setState({ model: 'm1', harness: 'claude-code', effort: 'high' });
});

afterEach(() => cleanup());

describe('NewConversationButton (PAN-5293 F-D12)', () => {
  it('quick-creates in the selected project, and unscoped for No project', () => {
    const view = render(<Harness selectedProject="proj" />);
    fireEvent.click(screen.getByTestId('new-conversation-button'));
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith('proj');
    view.unmount();

    render(<Harness selectedProject={NO_PROJECT_KEY} />);
    fireEvent.click(screen.getByTestId('new-conversation-button'));
    expect(create).toHaveBeenLastCalledWith(undefined);
  });

  it('the caret menu holds the model, harness and effort pickers, Retrospective and "with options…"', () => {
    render(<Harness selectedProject="proj" />);
    fireEvent.click(screen.getByTestId('new-conversation-caret'));
    const menu = screen.getByTestId('new-conversation-menu');
    expect(menu).toContainElement(screen.getByTestId('model-picker'));
    expect(screen.getByTestId('model-picker')).toHaveTextContent('m1');
    expect(screen.getByTestId('harness-picker')).toHaveTextContent('claude-code');
    expect(screen.getByTestId('effort-chip')).toHaveTextContent('high');
    expect(screen.getByRole('button', { name: 'Pipeline retrospective' })).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('model-picker'));
    fireEvent.click(screen.getByTestId('harness-picker'));
    fireEvent.click(screen.getByTestId('effort-chip'));
    expect(useNewConversationDefaults.getState()).toMatchObject({ model: 'm2', harness: 'codex', effort: 'low' });

    fireEvent.click(screen.getByTestId('new-conversation-with-options'));
    expect(openDialog).toHaveBeenCalledWith({ projectKey: 'proj' });
    expect(screen.queryByTestId('new-conversation-menu')).not.toBeInTheDocument();
  });

  it('N outside an input creates once; N in a textarea does nothing', () => {
    render(
      <>
        <Harness selectedProject="proj" />
        <textarea data-testid="field" />
      </>,
    );
    act(() => {
      fireEvent.keyDown(document.body, { key: 'n' });
    });
    expect(create).toHaveBeenCalledTimes(1);

    const field = screen.getByTestId('field');
    field.focus();
    act(() => {
      fireEvent.keyDown(field, { key: 'n' });
    });
    expect(create).toHaveBeenCalledTimes(1);
  });

  // PAN-5335 WI-8: the second line names the model, harness and effort it will spawn with.
  it('shows the default model and effort on a second line, and tracks a live default change', () => {
    useNewConversationDefaults.setState({ model: 'claude-opus-5-5', harness: 'claude-code', effort: 'high' });
    render(<Harness selectedProject="proj" />);

    expect(screen.getByTestId('new-conversation-summary')).toHaveTextContent('Opus 5.5 · High');
    expect(screen.getByTestId('new-conversation-button')).toHaveAccessibleName('New conversation');

    act(() => { useNewConversationDefaults.getState().setEffort('low'); });
    expect(screen.getByTestId('new-conversation-summary')).toHaveTextContent('Opus 5.5 · Low');
  });
});
