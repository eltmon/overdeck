/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AgentSection } from '../ActivityView/AgentSection';

// Mock CSS module
vi.mock('../styles/mission-control.module.css', () => ({
  default: new Proxy({}, {
    get: (_target, prop) => `mock-${String(prop)}`,
  }),
}));

function makeSection(overrides = {}) {
  return {
    type: 'work',
    sessionId: 'agent-pan-10',
    model: 'claude-opus-4-6',
    startedAt: '2026-02-08T10:00:00Z',
    duration: 300,
    status: 'running',
    transcript: 'Hello, world!',
    ...overrides,
  };
}

describe('AgentSection', () => {
  it('should render section type badge', () => {
    render(<AgentSection section={makeSection()} isUnread={false} onClick={() => {}} />);
    expect(screen.getByText('work')).toBeTruthy();
  });

  it('should render transcript content', () => {
    render(<AgentSection section={makeSection({ transcript: 'Some output text' })} isUnread={false} onClick={() => {}} />);
    expect(screen.getByText('Some output text')).toBeTruthy();
  });

  it('should show "(no output yet)" when transcript is empty', () => {
    render(<AgentSection section={makeSection({ transcript: '' })} isUnread={false} onClick={() => {}} />);
    expect(screen.getByText('(no output yet)')).toBeTruthy();
  });

  it('should display formatted model name for known models', () => {
    render(<AgentSection section={makeSection({ model: 'claude-opus-4-6' })} isUnread={false} onClick={() => {}} />);
    expect(screen.getByText('Opus 4.6')).toBeTruthy();
  });

  it('should display formatted model name for Sonnet', () => {
    render(<AgentSection section={makeSection({ model: 'claude-sonnet-4-5-20250929' })} isUnread={false} onClick={() => {}} />);
    expect(screen.getByText('Sonnet 4.5')).toBeTruthy();
  });

  it('should display formatted model name for Haiku', () => {
    render(<AgentSection section={makeSection({ model: 'claude-haiku-4-5-20251001' })} isUnread={false} onClick={() => {}} />);
    expect(screen.getByText('Haiku 4.5')).toBeTruthy();
  });

  it('should not display model badge when model is unknown', () => {
    const { container } = render(<AgentSection section={makeSection({ model: 'unknown' })} isUnread={false} onClick={() => {}} />);
    const modelSpans = container.querySelectorAll('.mock-sectionModel');
    expect(modelSpans.length).toBe(0);
  });

  it('should strip "specialist" from model display', () => {
    const { container } = render(<AgentSection section={makeSection({ model: 'specialist' })} isUnread={false} onClick={() => {}} />);
    const modelSpans = container.querySelectorAll('.mock-sectionModel');
    expect(modelSpans.length).toBe(0);
  });

  it('should format duration in seconds when < 60s', () => {
    render(<AgentSection section={makeSection({ duration: 45 })} isUnread={false} onClick={() => {}} />);
    expect(screen.getByText(/45s/)).toBeTruthy();
  });

  it('should format duration in minutes when < 1h', () => {
    render(<AgentSection section={makeSection({ duration: 300 })} isUnread={false} onClick={() => {}} />);
    expect(screen.getByText(/5m/)).toBeTruthy();
  });

  it('should format duration in hours and minutes when >= 1h', () => {
    render(<AgentSection section={makeSection({ duration: 3900 })} isUnread={false} onClick={() => {}} />);
    expect(screen.getByText(/1h 5m/)).toBeTruthy();
  });

  it('should not show duration when null', () => {
    const { container } = render(<AgentSection section={makeSection({ duration: null })} isUnread={false} onClick={() => {}} />);
    const timeSpan = container.querySelector('.mock-sectionTime');
    expect(timeSpan?.textContent).not.toContain('(');
  });

  it('should call onClick when section header is clicked', () => {
    const onClick = vi.fn();
    render(<AgentSection section={makeSection()} isUnread={false} onClick={onClick} />);
    const header = screen.getByTitle('Click to focus this section');
    fireEvent.click(header);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('should show unread indicator dot when isUnread is true', () => {
    const { container } = render(<AgentSection section={makeSection()} isUnread={true} onClick={() => {}} />);
    expect(container.querySelector('.mock-unreadDot')).toBeTruthy();
  });

  it('should not show unread indicator dot when isUnread is false', () => {
    const { container } = render(<AgentSection section={makeSection()} isUnread={false} onClick={() => {}} />);
    expect(container.querySelector('.mock-unreadDot')).toBeNull();
  });

  it('should render all section types with correct badge', () => {
    const types = ['planning', 'work', 'review', 'test', 'merge'];
    for (const type of types) {
      const { unmount } = render(
        <AgentSection section={makeSection({ type })} isUnread={false} onClick={() => {}} />
      );
      expect(screen.getByText(type)).toBeTruthy();
      unmount();
    }
  });

  it('should apply correct status class for running sections', () => {
    const { container } = render(<AgentSection section={makeSection({ status: 'running' })} isUnread={false} onClick={() => {}} />);
    const statusDot = container.querySelector('.mock-sectionStatus');
    expect(statusDot?.className).toContain('mock-statusRunning');
  });

  it('should apply correct status class for completed sections', () => {
    const { container } = render(<AgentSection section={makeSection({ status: 'completed' })} isUnread={false} onClick={() => {}} />);
    const statusDot = container.querySelector('.mock-sectionStatus');
    expect(statusDot?.className).toContain('mock-statusCompleted');
  });

  it('should apply correct status class for failed sections', () => {
    const { container } = render(<AgentSection section={makeSection({ status: 'failed' })} isUnread={false} onClick={() => {}} />);
    const statusDot = container.querySelector('.mock-sectionStatus');
    expect(statusDot?.className).toContain('mock-statusFailed');
  });

  it('should handle empty startedAt gracefully', () => {
    render(<AgentSection section={makeSection({ startedAt: '' })} isUnread={false} onClick={() => {}} />);
    // Should not throw
    expect(screen.getByText('work')).toBeTruthy();
  });
});
