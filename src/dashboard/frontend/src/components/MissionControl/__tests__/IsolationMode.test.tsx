/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { IsolationMode } from '../ActivityView/IsolationMode';

// Mock CSS module
vi.mock('../styles/mission-control.module.css', () => ({
  default: new Proxy({}, {
    get: (_target, prop) => `mock-${String(prop)}`,
  }),
}));

function makeSection(overrides = {}) {
  return {
    type: 'review',
    sessionId: 'review-pan-10-run-1',
    model: 'specialist',
    startedAt: '2026-02-08T14:00:00Z',
    duration: 300,
    status: 'completed',
    transcript: 'Review output content here.',
    ...overrides,
  };
}

describe('IsolationMode', () => {
  it('should render section type badge', () => {
    render(<IsolationMode section={makeSection()} onClose={() => {}} />);
    expect(screen.getByText('review')).toBeTruthy();
  });

  it('should render model name', () => {
    render(<IsolationMode section={makeSection({ model: 'claude-opus-4-6' })} onClose={() => {}} />);
    expect(screen.getByText('claude-opus-4-6')).toBeTruthy();
  });

  it('should render session ID', () => {
    render(<IsolationMode section={makeSection()} onClose={() => {}} />);
    expect(screen.getByText('review-pan-10-run-1')).toBeTruthy();
  });

  it('should render full transcript', () => {
    render(<IsolationMode section={makeSection({ transcript: 'Full review transcript...' })} onClose={() => {}} />);
    expect(screen.getByText('Full review transcript...')).toBeTruthy();
  });

  it('should show "(no output)" when transcript is empty', () => {
    render(<IsolationMode section={makeSection({ transcript: '' })} onClose={() => {}} />);
    expect(screen.getByText('(no output)')).toBeTruthy();
  });

  it('should show close button with "Esc to close" text', () => {
    render(<IsolationMode section={makeSection()} onClose={() => {}} />);
    expect(screen.getByText('Esc to close')).toBeTruthy();
  });

  it('should call onClose when close button is clicked', () => {
    const onClose = vi.fn();
    render(<IsolationMode section={makeSection()} onClose={onClose} />);
    fireEvent.click(screen.getByText('Esc to close'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('should render all section types', () => {
    const types = ['planning', 'work', 'review', 'test', 'merge'];
    for (const type of types) {
      const { unmount } = render(
        <IsolationMode section={makeSection({ type })} onClose={() => {}} />
      );
      expect(screen.getByText(type)).toBeTruthy();
      unmount();
    }
  });

  it('should render with overlay class', () => {
    const { container } = render(<IsolationMode section={makeSection()} onClose={() => {}} />);
    expect(container.querySelector('.mock-isolationOverlay')).toBeTruthy();
  });
});
