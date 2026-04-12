import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { TerminalTabs, savePinState, loadPersistedPin, type TerminalTab } from './TerminalTabs';

function makeTab(overrides: Partial<TerminalTab> = {}): TerminalTab {
  return {
    id: 'working',
    label: 'Work',
    sessionName: 'agent-123',
    isActive: true,
    disabled: false,
    ...overrides,
  };
}

const defaultProps = {
  issueId: 'pan-509',
  tabs: [makeTab()],
  selectedSession: 'agent-123',
  activePhase: 'working' as const,
  pinned: false,
  onSelectSession: vi.fn(),
  onTogglePin: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe('TerminalTabs', () => {
  describe('auto-follow behaviour', () => {
    it('switches to active tab when not pinned and active tab changes', () => {
      const onSelectSession = vi.fn();
      const tabs = [
        makeTab({ id: 'working', label: 'Work', sessionName: 'agent-123', isActive: false }),
        makeTab({ id: 'reviewing', label: 'Review', sessionName: 'specialist-proj-review-agent', isActive: true }),
      ];
      render(
        <TerminalTabs
          {...defaultProps}
          tabs={tabs}
          selectedSession="agent-123"
          activePhase="reviewing"
          pinned={false}
          onSelectSession={onSelectSession}
        />,
      );
      // useEffect fires — should auto-switch to the active (reviewing) tab
      expect(onSelectSession).toHaveBeenCalledWith('specialist-proj-review-agent');
    });

    it('does NOT auto-switch when pinned', () => {
      const onSelectSession = vi.fn();
      const tabs = [
        makeTab({ id: 'working', label: 'Work', sessionName: 'agent-123', isActive: false }),
        makeTab({ id: 'reviewing', label: 'Review', sessionName: 'specialist-proj-review-agent', isActive: true }),
      ];
      render(
        <TerminalTabs
          {...defaultProps}
          tabs={tabs}
          selectedSession="agent-123"
          activePhase="reviewing"
          pinned={true}
          onSelectSession={onSelectSession}
        />,
      );
      expect(onSelectSession).not.toHaveBeenCalled();
    });

    it('does NOT auto-switch when already on the active tab', () => {
      const onSelectSession = vi.fn();
      const tabs = [makeTab({ sessionName: 'agent-123', isActive: true })];
      render(
        <TerminalTabs
          {...defaultProps}
          tabs={tabs}
          selectedSession="agent-123"
          pinned={false}
          onSelectSession={onSelectSession}
        />,
      );
      expect(onSelectSession).not.toHaveBeenCalled();
    });

    it('does NOT auto-switch to disabled active tab', () => {
      const onSelectSession = vi.fn();
      const tabs = [
        makeTab({ id: 'working', label: 'Work', sessionName: 'agent-123', isActive: false }),
        makeTab({ id: 'reviewing', label: 'Review', sessionName: 'specialist-proj-review-agent', isActive: true, disabled: true }),
      ];
      render(
        <TerminalTabs
          {...defaultProps}
          tabs={tabs}
          selectedSession="agent-123"
          activePhase="reviewing"
          pinned={false}
          onSelectSession={onSelectSession}
        />,
      );
      expect(onSelectSession).not.toHaveBeenCalled();
    });
  });

  describe('tab click behaviour', () => {
    it('calls onSelectSession when an enabled tab is clicked', () => {
      const onSelectSession = vi.fn();
      const tabs = [
        makeTab({ id: 'working', label: 'Work', sessionName: 'agent-123', isActive: true }),
        makeTab({ id: 'reviewing', label: 'Review', sessionName: 'specialist-review-agent', isActive: false }),
      ];
      render(
        <TerminalTabs
          {...defaultProps}
          tabs={tabs}
          selectedSession="agent-123"
          pinned={false}
          onSelectSession={onSelectSession}
        />,
      );
      fireEvent.click(screen.getByText('Review'));
      expect(onSelectSession).toHaveBeenCalledWith('specialist-review-agent');
    });

    it('clicking a non-active tab engages pin', () => {
      const onTogglePin = vi.fn();
      const tabs = [
        makeTab({ id: 'working', label: 'Work', sessionName: 'agent-123', isActive: true }),
        makeTab({ id: 'reviewing', label: 'Review', sessionName: 'specialist-review-agent', isActive: false }),
      ];
      render(
        <TerminalTabs
          {...defaultProps}
          tabs={tabs}
          selectedSession="agent-123"
          pinned={false}
          onTogglePin={onTogglePin}
        />,
      );
      fireEvent.click(screen.getByText('Review'));
      expect(onTogglePin).toHaveBeenCalled();
    });

    it('does NOT call onSelectSession for disabled tabs', () => {
      const onSelectSession = vi.fn();
      const tabs = [makeTab({ label: 'Test', disabled: true, isActive: false })];
      render(
        <TerminalTabs
          {...defaultProps}
          tabs={tabs}
          selectedSession={null}
          pinned={false}
          onSelectSession={onSelectSession}
        />,
      );
      fireEvent.click(screen.getByText('Test'));
      expect(onSelectSession).not.toHaveBeenCalled();
    });
  });

  describe('pin toggle button', () => {
    it('shows Auto when not pinned', () => {
      render(<TerminalTabs {...defaultProps} pinned={false} />);
      expect(screen.getByText('Auto')).toBeTruthy();
    });

    it('shows Pinned when pinned', () => {
      render(<TerminalTabs {...defaultProps} pinned={true} />);
      expect(screen.getByText('Pinned')).toBeTruthy();
    });

    it('calls onTogglePin when clicked', () => {
      const onTogglePin = vi.fn();
      render(<TerminalTabs {...defaultProps} onTogglePin={onTogglePin} />);
      // Find the pin toggle button (contains "Auto" text)
      fireEvent.click(screen.getByText('Auto').closest('button')!);
      expect(onTogglePin).toHaveBeenCalled();
    });
  });

  describe('phase chip', () => {
    it('renders the phase label for known phases', () => {
      render(<TerminalTabs {...defaultProps} activePhase="reviewing" />);
      expect(screen.getByText('Reviewing')).toBeTruthy();
    });

    it('renders the raw phase string for unknown phases', () => {
      render(<TerminalTabs {...defaultProps} activePhase="custom-phase" />);
      expect(screen.getByText('custom-phase')).toBeTruthy();
    });
  });

  describe('localStorage pin persistence', () => {
    it('savePinState stores session name in localStorage', () => {
      savePinState('pan-509', 'specialist-review-agent');
      expect(localStorage.getItem('pan-terminal-pin-pan-509')).toBe('specialist-review-agent');
    });

    it('savePinState removes item when null', () => {
      localStorage.setItem('pan-terminal-pin-pan-509', 'old');
      savePinState('pan-509', null);
      expect(localStorage.getItem('pan-terminal-pin-pan-509')).toBeNull();
    });

    it('loadPersistedPin returns stored value', () => {
      localStorage.setItem('pan-terminal-pin-pan-509', 'agent-xyz');
      expect(loadPersistedPin('pan-509')).toBe('agent-xyz');
    });

    it('loadPersistedPin returns null when not set', () => {
      expect(loadPersistedPin('pan-509')).toBeNull();
    });

    it('clicking a tab calls onSelectSession with the session name (parent handles persistence)', () => {
      const onSelectSession = vi.fn();
      const tabs = [
        makeTab({ id: 'working', label: 'Work', sessionName: 'agent-123', isActive: true }),
        makeTab({ id: 'reviewing', label: 'Review', sessionName: 'specialist-review-agent', isActive: false }),
      ];
      render(
        <TerminalTabs
          {...defaultProps}
          issueId="pan-509"
          tabs={tabs}
          selectedSession="agent-123"
          pinned={false}
          onSelectSession={onSelectSession}
        />,
      );
      act(() => {
        fireEvent.click(screen.getByText('Review'));
      });
      expect(onSelectSession).toHaveBeenCalledWith('specialist-review-agent');
    });
  });
});
